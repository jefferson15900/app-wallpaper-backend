const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    update: { type: mongoose.Schema.Types.ObjectId, ref: 'WallpaperUpdate', required: true },
}, { timestamps: true });
schema.index({ user: 1, update: 1 }, { unique: true });
schema.index({ createdAt: 1 });
module.exports = mongoose.model('UpdateDismissal', schema);
