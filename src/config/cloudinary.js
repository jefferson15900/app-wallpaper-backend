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
        { width: 2500, crop: "limit" }, // Aumentamos a 2500 para permitir archivos 2K o 4K originales
        { quality: "auto:best"},        // Cambiamos 'good' por 'best' para el archivo maestro
        { fetch_format: "auto" }     // Convierte a WebP automáticamente (pesa 80% menos)
      ],
    };
  },
});

const uploadCloud = multer({ storage });

module.exports = { cloudinary, uploadCloud };