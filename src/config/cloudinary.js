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
      allowed_formats: ['jpg', 'png', 'jpeg'],
      // --- TRUCO DE COMPRESIÓN MÁGICA ---
      transformation: [
        { width: 1600, crop: "limit" }, // Limita el ancho máximo a 1080p (suficiente para móviles)
        { quality: "auto:good"},           // Google/Cloudinary eligen la mejor compresión
        { fetch_format: "auto" }       // Convierte a WebP automáticamente (pesa 80% menos)
      ],
    };
  },
});

const uploadCloud = multer({ storage });

module.exports = { cloudinary, uploadCloud };