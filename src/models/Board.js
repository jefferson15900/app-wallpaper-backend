const mongoose = require('mongoose');

const BoardSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: "" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    wallpapers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Wallpaper' }],
    isPrivate: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Board', BoardSchema);
