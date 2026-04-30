const mongoose = require('mongoose');

const SearchLogSchema = new mongoose.Schema({
    term: { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true, 
        trim: true 
    },
    count: { 
        type: Number, 
        default: 1 
    }
}, { 
    timestamps: true // 👈 ESTO ES CLAVE: Crea 'createdAt' y 'updatedAt' automáticamente
});

SearchLogSchema.index({ count: -1 });

module.exports = mongoose.model('SearchLog', SearchLogSchema);