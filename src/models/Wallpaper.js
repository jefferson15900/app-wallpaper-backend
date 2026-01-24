const mongoose = require('mongoose');
const WallpaperSchema = new mongoose.Schema({
    title: { type: String, required: true },
    tags: [{ type: String }],
    imageUrl: { type: String, required: true }, 
    public_id: { type: String, required: true },
    category: { type: String, default: 'General' },
    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downloads: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending'}, 

});
module.exports = mongoose.model('Wallpaper', WallpaperSchema);