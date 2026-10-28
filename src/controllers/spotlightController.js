const mongoose = require('mongoose');
const Spotlight = require('../models/Spotlight');
const Wallpaper = require('../models/Wallpaper');
const coverStorage = require('../services/spotlightCoverStorage');
const { normalizeTerm, resolveMetadataAlias, matchedAssetId } = require('../utils/wallpaperMetadata');

function text(value, max, required = false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
        throw Object.assign(new Error('Revisa los textos del banner y su longitud.'), { status: 400 });
    }
    return value.trim();
}

function tagFilter(tag) {
    // Literal, whole-tag matching: a collection must never become a fuzzy search.
    return { status: 'approved', tags: new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
}

exports.getSpotlights = async (req, res) => {
    try {
        const recent = { createdAt: { $gte: new Date(Date.now() - 86400000) } };
        const query = req.query.format === '2'
            ? { $or: [{ targetType: 'collection' }, recent] }
            : { ...recent, targetType: { $ne: 'collection' } };
        const banners = await Spotlight.find(query).populate({ path: 'wallpaperId',
            populate: { path: 'artist', select: 'username profilePic isVerified' } }).sort({ createdAt: -1 });
        res.set('Cache-Control', 'no-store');
        return res.json(banners.filter(banner =>
            (banner.targetType === 'collection' && banner.coverKind !== 'wallpaper') ||
            banner.wallpaperId?.status === 'approved'));
    } catch {
        return res.status(500).json({ msg: 'No se pudieron cargar los banners.' });
    }
};

exports.addSpotlight = async (req, res) => {
    let uploadedCover;
    try {
        let body = req.body || {};
        if (body.draft !== undefined) {
            try { body = JSON.parse(body.draft); }
            catch { return res.status(400).json({ msg: 'Los datos del banner no son válidos.' }); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ msg: 'Los datos del banner no son válidos.' });
        }
        const targetType = body.targetType ?? 'wallpaper';
        const typography = body.typography ?? 'normal';
        const coverKind = targetType === 'wallpaper' ? 'wallpaper' : (body.coverKind ?? 'wallpaper');
        if (!['wallpaper', 'collection'].includes(targetType) || !['normal', 'halloween', 'christmas'].includes(typography)
            || !['wallpaper', 'halloween', 'url', 'upload'].includes(coverKind)) {
            return res.status(400).json({ msg: 'Elige un tipo de banner, portada y tipografía válidos.' });
        }
        if ((coverKind === 'upload') !== !!req.file) return res.status(400).json({ msg: 'Selecciona una imagen para la portada.' });
        const title = text(body.title, 90, true);
        const subtitle = text(body.subtitle, 140);
        const copy = {};
        for (const language of ['es', 'en']) {
            copy[language] = { title: text(body.copy?.[language]?.title, 90), subtitle: text(body.copy?.[language]?.subtitle, 140) };
        }
        let collectionTag;
        if (targetType === 'collection') {
            const rawTag = normalizeTerm(text(body.collectionTag, 80, true));
            collectionTag = resolveMetadataAlias(rawTag) ?? rawTag;
            if (!collectionTag) return res.status(400).json({ msg: 'Elige una etiqueta.' });
        }
        let wallpaperId;
        if (coverKind === 'wallpaper') {
            if (!mongoose.isValidObjectId(body.wallpaperId)) return res.status(400).json({ msg: 'Elige un fondo válido.' });
            const wallpaper = await Wallpaper.findById(body.wallpaperId);
            if (!wallpaper || wallpaper.status !== 'approved') return res.status(404).json({ msg: 'El fondo debe estar publicado.' });
            if (wallpaper.type === 'video') return res.status(400).json({ msg: 'Elige una imagen como portada del banner.' });
            wallpaperId = wallpaper._id;
        }
        let coverUrl;
        if (coverKind === 'url') {
            coverUrl = text(body.coverUrl, 2048, true);
            let url;
            try { url = new URL(coverUrl); } catch { /* validated below */ }
            if (!url || url.protocol !== 'https:' || url.username || url.password) {
                return res.status(400).json({ msg: 'La portada debe ser una URL HTTPS de imagen.' });
            }
        }
        if (coverKind === 'upload') {
            uploadedCover = await coverStorage.upload(req.file.buffer);
            coverUrl = uploadedCover.secure_url;
        }
        const banner = await Spotlight.create({ targetType, title, subtitle, copy, typography,
            collectionTag, wallpaperId, coverKind: coverKind === 'upload' ? 'url' : coverKind, coverUrl,
            coverPublicId: uploadedCover?.public_id });
        return res.status(201).json(banner);
    } catch (error) {
        if (uploadedCover?.public_id) {
            try { await coverStorage.remove(uploadedCover.public_id); }
            catch (cleanupError) { console.error('No se pudo retirar la portada sin banner:', cleanupError.message); }
        }
        return res.status(error.status || 500).json({ msg: error.status ? error.message : 'No se pudo guardar el banner.' });
    }
};

exports.getCollection = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Colección inválida.' });
    try {
        const banner = await Spotlight.findOne({ _id: req.params.id, targetType: 'collection' });
        if (!banner) return res.status(404).json({ msg: 'Esta colección ya no está disponible.' });
        const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
        const limit = 20;
        const records = await Wallpaper.find(tagFilter(banner.collectionTag)).sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit).limit(limit + 1).populate('artist', 'username profilePic isVerified');
        res.set('Cache-Control', 'no-store');
        const items = records.slice(0, limit).map(record => {
            const item = record.toObject ? record.toObject() : record;
            const assetId = matchedAssetId(item, banner.collectionTag);
            return assetId ? { ...item, matchedAssetId: assetId } : item;
        });
        return res.json({ items, hasMore: records.length > limit });
    } catch {
        return res.status(500).json({ msg: 'No se pudieron cargar los fondos de la colección.' });
    }
};

exports.deleteSpotlight = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Banner inválido.' });
    try {
        const banner = await Spotlight.findByIdAndDelete(req.params.id);
        if (banner?.coverPublicId) {
            try { await coverStorage.remove(banner.coverPublicId); }
            catch (error) { console.error('No se pudo retirar la portada del banner eliminado:', error.message); }
        }
        return banner ? res.json({ msg: 'Banner eliminado.' }) : res.status(404).json({ msg: 'Banner no encontrado.' });
    } catch {
        return res.status(500).json({ msg: 'No se pudo eliminar el banner.' });
    }
};
