const mongoose = require('mongoose');
const WallpaperSchema = new mongoose.Schema({
    title: { type: String, required: true },
    imageUrl: { type: String, required: true }, // URL de Cloudinary
    public_id: { type: String, required: true }, // ID para borrar de Cloudinary
    category: { type: String, default: 'General' }, // <--- Nuevo campo
    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downloads: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending'}, // Al subir, siempre es pendiente

});
module.exports = mongoose.model('Wallpaper', WallpaperSchema);