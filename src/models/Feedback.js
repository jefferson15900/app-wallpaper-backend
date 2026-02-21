const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['comentario', 'problema', 'reporte_wallpaper'], required: true },
    message: { type: String, required: true },
    targetWallpaper: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallpaper' }, 
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', FeedbackSchema);