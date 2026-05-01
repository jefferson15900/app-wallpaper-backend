const mongoose = require('mongoose');

const FeedCacheSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        unique: true 
    },
    // Guardamos solo los IDs de los wallpapers para que sea ligero
    wallpapers: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Wallpaper' 
    }],
    createdAt: { 
        type: Date, 
        default: Date.now, 
        expires: 3600 // 👈 El cache se borra solo cada 1 hora (libera espacio auto)
    }
});

module.exports = mongoose.model('FeedCache', FeedCacheSchema);