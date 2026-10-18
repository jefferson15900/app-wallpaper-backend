const Wallpaper = require('../models/Wallpaper');
const mongoose = require('mongoose');
const User = require('../models/User');
const { normalizeMetadata, searchTagsFor, metadataError } = require('../utils/wallpaperMetadata');

// Compare-and-swap keeps late AI output from overwriting newer manual edits.
async function updateMetadata(wallpaperId, transform, pendingOnly = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const wallpaper = await Wallpaper.findById(wallpaperId).lean();
        if (!wallpaper) { throw Object.assign(new Error('Wallpaper no encontrado.'), { statusCode: 404 }); }
        if (pendingOnly && wallpaper.status !== 'pending') {
            throw Object.assign(new Error('Este wallpaper ya no está pendiente de revisión.'), { statusCode: 409 });
        }
        const changes = transform(wallpaper);
        const next = { ...wallpaper, manualTags: wallpaper.manualTags ?? wallpaper.tags ?? [], ...changes };
        const revisionFilter = wallpaper.metadataRevision === undefined
            ? { metadataRevision: { $exists: false } } : { metadataRevision: wallpaper.metadataRevision };
        const saved = await Wallpaper.findOneAndUpdate({ _id: wallpaperId, ...revisionFilter,
            ...(pendingOnly ? { status: 'pending' } : {}),
        }, { $set: { ...changes, manualTags: next.manualTags, tags: searchTagsFor(next), metadataVersion: 1 }, $inc: { metadataRevision: 1 } }, { new: true, runValidators: true });
        if (saved) { return saved; }
    }
    throw Object.assign(new Error('El contenido cambió mientras se guardaba. Intenta de nuevo.'), { statusCode: 409 });
}

function manualMetadataChanges(wallpaper, body) {
    const changes = {};
    if ('tags' in body) { changes.manualTags = body.tags; }
    if ('metadata' in body) { changes.metadata = normalizeMetadata(body.metadata); }
    if ('assetMetadata' in body) {
        if (!Array.isArray(body.assetMetadata) || body.assetMetadata.length > 10) {
            throw metadataError('Envía hasta 10 imágenes con su assetId y metadata.');
        }
        const ids = new Set();
        const images = (wallpaper.images || []).map(image => ({ ...image }));
        for (const entry of body.assetMetadata) {
            if (!entry || typeof entry.assetId !== 'string' || Object.keys(entry).some(key => !['assetId', 'metadata'].includes(key)) || ids.has(entry.assetId)) {
                throw metadataError('Cada imagen debe tener un assetId único y metadata.');
            }
            const image = images.find(image => image.assetId === entry.assetId);
            if (!image) { throw metadataError('La imagen no pertenece a esta publicación o aún no tiene assetId.'); }
            image.metadata = normalizeMetadata(entry.metadata);
            ids.add(entry.assetId);
        }
        changes.images = images;
    }
    return changes;
}

function mergedMetadataChanges(primary, secondary) {
    const imagesFor = wallpaper => (wallpaper.images?.length ? wallpaper.images : [{ imageUrl: wallpaper.imageUrl, public_id: wallpaper.public_id }]).map(image => ({
        ...image, metadata: { ...(wallpaper.metadata || {}), ...(image.metadata || {}) },
    }));
    const images = imagesFor(primary);
    for (const image of imagesFor(secondary)) {
        if (!images.some(existing => (existing.public_id && existing.public_id === image.public_id) || (existing.imageUrl && existing.imageUrl === image.imageUrl))) { images.push(image); }
    }
    const changes = { images, metadata: undefined, metadataVersion: 1,
        manualTags: [...new Set([...(primary.manualTags ?? primary.tags ?? []), ...(secondary.manualTags ?? secondary.tags ?? [])])],
        downloads: (primary.downloads || 0) + (secondary.downloads || 0),
        likes: [...new Set([...(primary.likes || []), ...(secondary.likes || [])].map(String))],
        isAITagged: !!(primary.isAITagged || secondary.isAITagged),
    };
    changes.tags = searchTagsFor({ ...primary, ...changes });
    return changes;
}

async function mergeWithMetadata(primaryId, secondaryId) {
    const session = await mongoose.startSession();
    let merged;
    try {
        await session.withTransaction(async () => {
            const primary = await Wallpaper.findById(primaryId).session(session).lean();
            const secondary = await Wallpaper.findById(secondaryId).session(session).lean();
            if (!primary || !secondary) { throw Object.assign(new Error('Wallpaper no encontrado.'), { statusCode: 404 }); }
            if ((primary.type || 'image') !== (secondary.type || 'image')) { throw metadataError('No se pueden fusionar imágenes con videos.'); }
            if ([primary, secondary].some(wallpaper => wallpaper.images?.some(image => ['pending', 'processing'].includes(image.analysis?.status)))) {
                throw Object.assign(new Error('Espera a que termine el análisis de IA antes de fusionar.'), { statusCode: 409 });
            }
            const changes = mergedMetadataChanges(primary, secondary);
            if (changes.images.length > 10) { throw metadataError('Una publicación admite hasta 10 archivos.'); }
            delete changes.metadata;
            merged = await Wallpaper.findByIdAndUpdate(primaryId, {
                $set: changes, $unset: { metadata: 1 }, $inc: { metadataRevision: 1 },
            }, { new: true, runValidators: true, session });
            await Wallpaper.findByIdAndDelete(secondaryId, { session });
            await User.findByIdAndUpdate(secondary.artist, { $inc: { wallpaperCount: -1 } }, { session });
        });
        return merged;
    } finally { await session.endSession(); }
}

module.exports = { updateMetadata, manualMetadataChanges, mergedMetadataChanges, mergeWithMetadata };
