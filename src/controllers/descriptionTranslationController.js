const User = require('../models/User');
const { translateDescription } = require('../services/aiService');
const { normalizeMetadata } = require('../utils/wallpaperMetadata');

async function translateWallpaperDescription(req, res) {
    try {
        const user = await User.findById(req.user.id).lean();
        if (!user || (user.role !== 'admin' && !user.isVerified)) {
            return res.status(403).json({ msg: 'La traducción está disponible para artistas verificados y administradores.' });
        }
        if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 1
            || !Object.keys(req.body).every(key => ['descriptionEs', 'descriptionEn'].includes(key))) {
            return res.status(400).json({ msg: 'Envía una sola descripción de origen, en español o inglés.' });
        }
        const field = Object.keys(req.body)[0];
        const source = normalizeMetadata(req.body)[field];
        if (!source) { return res.status(400).json({ msg: 'Escribe primero la descripción de origen.' }); }
        return res.json(await translateDescription(source, field === 'descriptionEs' ? 'es' : 'en'));
    } catch (error) {
        if (error.statusCode === 400 || error.statusCode === 503) {
            return res.status(error.statusCode).json({ msg: error.message });
        }
        if (error.status === 429) {
            return res.status(429).json({ msg: 'Se alcanzó el límite de traducciones de Google. Puedes guardar solo el original o escribir la traducción.' });
        }
        return res.status(502).json({ msg: 'No se pudo traducir. Se conserva tu texto; puedes guardar solo el original o escribir la traducción.' });
    }
}

module.exports = { translateWallpaperDescription };
