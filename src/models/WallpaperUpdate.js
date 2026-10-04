const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    text: { type: String, required: true, trim: true, maxlength: 160 },
    coverWallpaper: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallpaper', required: true },
    wallpapers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Wallpaper', required: true }],
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
schema.index({ createdAt: -1, _id: -1 });
module.exports = mongoose.model('WallpaperUpdate', schema);
