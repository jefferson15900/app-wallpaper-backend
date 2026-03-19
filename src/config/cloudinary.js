const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Definimos carpetas diferentes para iconos y wallpapers
    const folderName = file.fieldname === 'avatar' ? 'perfiles_app' : 'wallpapers_app';

    return {
      folder: folderName,
      resource_type: isVideo ? 'video' : 'image',
      allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'mov', 'webm'],
      // --- TRUCO DE COMPRESIÓN MÁGICA ---
      transformation: isVideo ? [
        { width: 1440, crop: "limit" }, // Resolución 2K máxima
        { quality: "auto:eco" },        // 'eco' es mejor para ahorrar ancho de banda en video
        { fetch_format: "auto" }        // Sirve WebM a Android para que pese 50% menos
      ] : [
        { width: 2500, crop: "limit" },
        { quality: "auto:best"},
        { fetch_format: "auto" }
      ],
    };
  },
});

const uploadCloud = multer({ storage });

module.exports = { cloudinary, uploadCloud };