const User = require('../models/User');
const { translateDescription } = require('../services/aiService');
const { normalizeMetadata } = require('../utils/wallpaperMetadata');

async function translateWallpaperDescription(req, res) {
    try {
        const user = await User.findById(req.user.id).lean();
        if (!user || (user.role !== 'admin' && !user.isVerified)) {
            return res.status(403).json({ msg: 'La traducción está disponible para artistas verificados y administradores.' });
        }
        if (!req.body || Object.keys(req.body).some(key => key !== 'descriptionEs')) {
            return res.status(400).json({ msg: 'Envía solo la descripción en español.' });
        }
        const { descriptionEs } = normalizeMetadata({ descriptionEs: req.body.descriptionEs });
        if (!descriptionEs) { return res.status(400).json({ msg: 'Escribe primero la descripción en español.' }); }
        return res.json(await translateDescription(descriptionEs));
    } catch (error) {
        if (error.statusCode === 400 || error.statusCode === 503) {
            return res.status(error.statusCode).json({ msg: error.message });
        }
        if (error.status === 429) {
            return res.status(429).json({ msg: 'Se alcanzó el límite de traducciones de Google. Puedes subir solo el español o escribir el inglés.' });
        }
        return res.status(502).json({ msg: 'No se pudo traducir. Se conserva tu texto; puedes subir solo el español o escribir el inglés.' });
    }
}

module.exports = { translateWallpaperDescription };
