const mongoose = require('mongoose');

const FeedCacheSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        unique: true 
    },
    // Guardamos el snapshot completo para no tener que hacer populate al leer
    snapshot: [mongoose.Schema.Types.Mixed],
    updatedAt: {
        type: Date,
        default: Date.now
    },
    createdAt: { 
        type: Date, 
        default: Date.now, 
        expires: 3600 // 👈 El cache se borra solo cada 1 hora (libera espacio auto)
    }
});

module.exports = mongoose.model('FeedCache', FeedCacheSchema);