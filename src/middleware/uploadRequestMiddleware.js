const Wallpaper = require('../models/Wallpaper');

// The same file keeps its UUID when the client retries after a lost response.
module.exports = async (req, res, next) => {
    const requestId = req.get('x-upload-id');
    if (!requestId) return next(); // Existing clients can keep using the endpoint.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return res.status(400).json({ msg: 'Identificador de subida inválido.' });
    }
    req.uploadRequestId = requestId.toLowerCase();
    try {
        // Wait for the unique index before accepting retryable uploads.
        await Wallpaper.init();
        const existing = await Wallpaper.findOne({ artist: req.user.id, uploadRequestId: req.uploadRequestId }).lean();
        if (existing) return res.json(existing);
        return next();
    } catch (error) {
        console.error('Error comprobando subida:', error.message);
        return res.status(503).json({ msg: 'No se pudo comprobar la subida. Intenta de nuevo.' });
    }
};
