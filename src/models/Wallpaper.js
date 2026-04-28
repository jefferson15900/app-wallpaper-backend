const mongoose = require('mongoose');
const WallpaperSchema = new mongoose.Schema({
    tags: [{ type: String }],
    imageUrl: { type: String, required: true }, 
    public_id: { type: String, required: true },
    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downloads: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending'}, 
    isPremium: { type: Boolean, default: false }, 
    isAITagged: { type: Boolean, default: false },
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    price: { type: Number, default: 0 }, 
});

WallpaperSchema.index({ status: 1, createdAt: -1 });
WallpaperSchema.index({ category: 1 });
WallpaperSchema.index({ artist: 1 });
module.exports = mongoose.model('Wallpaper', WallpaperSchema);