const Wallpaper = require('../models/Wallpaper');
const { isId } = require('../utils/updateValidation');

exports.editPendingWallpaper = async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ msg: 'Wallpaper no válido.' });
    const body = req.body;
    const allowed = ['tags', 'price', 'isPremium'];
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !allowed.includes(key)) || !Object.keys(body).length) {
        return res.status(400).json({ msg: 'Los datos de edición no son válidos.' });
    }
    const changes = {};
    if ('tags' in body) {
        if (!Array.isArray(body.tags) || body.tags.length > 100 ||
            body.tags.some(tag => typeof tag !== 'string')) {
            return res.status(400).json({ msg: 'Usa hasta 100 etiquetas de texto.' });
        }
        changes.tags = [...new Set(body.tags.map(tag => tag.trim().replace(/^#+/, '').trim().toLowerCase()).filter(Boolean))];
    }
    if ('price' in body) {
        if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) {
            return res.status(400).json({ msg: 'El precio debe ser un número mayor o igual a cero.' });
        }
        changes.price = body.price;
    }
    if ('isPremium' in body) {
        if (typeof body.isPremium !== 'boolean') return res.status(400).json({ msg: 'El estado de destacado no es válido.' });
        changes.isPremium = body.isPremium;
    }
    try {
        // Atomic pending filter prevents edits after another moderator approves/rejects.
        const wallpaper = await Wallpaper.findOneAndUpdate(
            { _id: req.params.id, status: 'pending' }, { $set: changes }, { new: true, runValidators: true }
        ).populate('artist', 'username email');
        if (!wallpaper) {
            const exists = await Wallpaper.exists({ _id: req.params.id });
            return res.status(exists ? 409 : 404).json({ msg: exists
                ? 'Este wallpaper ya no está pendiente de revisión.' : 'Wallpaper no encontrado.' });
        }
        return res.json(wallpaper);
    } catch (error) {
        console.error('Error al editar wallpaper pendiente:', error);
        return res.status(500).json({ msg: 'No se pudieron guardar los cambios. Intenta de nuevo.' });
    }
};
