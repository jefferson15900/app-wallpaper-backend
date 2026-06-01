const mongoose = require('mongoose');

const RelatedCacheSchema = new mongoose.Schema({
    wallpaperId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallpaper', required: true, unique: true },
    snapshot: [mongoose.Schema.Types.Mixed],
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // 👈 Dura 24 horas
});

module.exports = mongoose.model('RelatedCache', RelatedCacheSchema);