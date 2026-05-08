const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key   : process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Detección robusta solo por mimetype
const isVideoFile = (file) => file.mimetype.startsWith('video/');

const VALID_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const VALID_VIDEO_FORMATS = ['mp4', 'mov', 'webm'];

const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const isVideo    = isVideoFile(file);
        const folderName = file.fieldname === 'avatar' 
            ? 'perfiles_app' 
            : 'wallpapers_app';

        return {
            folder          : folderName,
            resource_type   : isVideo ? 'video' : 'image',
            allowed_formats : isVideo ? VALID_VIDEO_FORMATS : VALID_IMAGE_FORMATS,

            transformation: isVideo
                ? [
                    { width: 1440, crop: 'limit' },
                    { quality: 'auto:good' },
                    { audio_codec: 'none' },  
                ]
                : [
                    { width: 2500, crop: 'limit' }, 
                    { quality: 'auto:good' },      
                    { fetch_format: 'auto' },
                ],
        };
    },
});

const uploadCloud = multer({
    storage,
    limits: {
        fileSize: 150 * 1024 * 1024, // 150 MB máximo
    },
    fileFilter: (req, file, cb) => {
        const isVideo   = isVideoFile(file);
        const validExts = isVideo ? VALID_VIDEO_FORMATS : VALID_IMAGE_FORMATS;
        const ext       = file.originalname.split('.').pop().toLowerCase();

        if (!validExts.includes(ext)) {
            return cb(new Error(`Formato no permitido: ${ext}`), false);
        }
        cb(null, true);
    },
});

module.exports = { cloudinary, uploadCloud };