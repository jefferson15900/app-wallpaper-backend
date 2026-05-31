const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// --- CUENTA A (Imágenes y Perfiles) ---
const cloudinaryPrimary = new cloudinary.Cloudinary({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key   : process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// --- CUENTA B (Videos) ---
const cloudinarySecondary = new cloudinary.Cloudinary({
    cloud_name: process.env.CLOUDINARY_VIDEO_CLOUD_NAME,
    api_key   : process.env.CLOUDINARY_VIDEO_API_KEY,
    api_secret: process.env.CLOUDINARY_VIDEO_API_SECRET,
    secure: true
});

const VALID_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const VALID_VIDEO_FORMATS = ['mp4', 'mov', 'webm'];

// STORAGE A: IMÁGENES
const imageStorage = new CloudinaryStorage({
    cloudinary: cloudinaryPrimary,
    params: async (req, file) => ({
        folder: file.fieldname === 'avatar' ? 'perfiles_app' : 'wallpapers_app',
        resource_type: 'image',
        allowed_formats: VALID_IMAGE_FORMATS,
        transformation: [
            { width: 2500, crop: 'limit' }, 
            { quality: 'auto:good' },      
            { fetch_format: 'auto' }
        ]
    })
});

// STORAGE B: VIDEOS
const videoStorage = new CloudinaryStorage({
    cloudinary: cloudinarySecondary,
    params: async (req, file) => ({
        folder: 'wallpapers_videos',
        resource_type: 'video',
        allowed_formats: VALID_VIDEO_FORMATS,
        transformation: [
            { width: 1440, crop: 'limit' },
            { quality: 'auto:good' },
            { audio_codec: 'none' }
        ]
    })
});

// MOTOR DE ALMACENAMIENTO DINÁMICO
const dynamicStorage = {
    _handleFile: (req, file, cb) => {
        console.log("=== DYNAMIC STORAGE UPLOAD ===");
        console.log("File details:", {
            originalname: file.originalname,
            mimetype: file.mimetype,
            fieldname: file.fieldname
        });
        console.log("Secondary Cloud Config:", {
            cloud_name: cloudinarySecondary.config().cloud_name,
            has_key: !!cloudinarySecondary.config().api_key,
            has_secret: !!cloudinarySecondary.config().api_secret
        });

        if (file.mimetype.startsWith('video/')) {
            console.log("Routing to videoStorage (Secondary Cloud)");
            videoStorage._handleFile(req, file, cb);
        } else {
            console.log("Routing to imageStorage (Primary Cloud)");
            imageStorage._handleFile(req, file, cb);
        }
    },
    _removeFile: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            videoStorage._removeFile(req, file, cb);
        } else {
            imageStorage._removeFile(req, file, cb);
        }
    }
};

// MIDDLEWARE UNIFICADO
const uploadCloud = multer({
    storage: dynamicStorage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB máx para soportar videos grandes
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const isVideo = file.mimetype.startsWith('video/');
        const isImage = file.mimetype.startsWith('image/');

        if (!isVideo && !isImage) {
            return cb(new Error('TIPO_ARCHIVO_NO_PERMITIDO'), false);
        }

        const allowedExts = isVideo ? ['.mp4', '.mov', '.webm'] : ['.jpg', '.jpeg', '.png', '.webp'];
        const isExtValid = allowedExts.some(ext => 
            file.originalname.toLowerCase().endsWith(ext)
        );

        if (!isExtValid) {
            return cb(new Error('EXTENSION_NO_VALIDA'), false);
        }

        cb(null, true);
    }
});

module.exports = { 
    cloudinaryPrimary, 
    cloudinarySecondary, 
    uploadCloud
};

