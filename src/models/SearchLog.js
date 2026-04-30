const mongoose = require('mongoose');

const SearchLogSchema = new mongoose.Schema({
    // Guardamos la palabra limpia y en minúsculas
    term: { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true, 
        trim: true 
    },
    // Contador de búsquedas
    count: { 
        type: Number, 
        default: 1 
    },
    // Para saber cuándo fue la última vez que alguien tuvo interés en esto
    lastSearchedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Índice para que cuando busques el Top 10 sea instantáneo
SearchLogSchema.index({ count: -1 });

module.exports = mongoose.model('SearchLog', SearchLogSchema);