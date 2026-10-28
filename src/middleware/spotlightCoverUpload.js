const multer = require('multer');

// Keep the file in memory until the banner fields have passed validation.
const receive = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32 * 1024 },
    fileFilter: (req, file, callback) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        callback(allowed ? null : new Error('Elige una imagen JPG, PNG o WebP.'), allowed);
    },
}).single('cover');

module.exports = (req, res, next) => receive(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        msg: error.code === 'LIMIT_FILE_SIZE' ? 'La portada debe pesar menos de 10 MB.' : 'Elige una sola imagen JPG, PNG o WebP.',
    });
});
