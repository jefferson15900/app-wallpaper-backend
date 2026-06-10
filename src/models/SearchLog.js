const mongoose = require('mongoose');

const SearchLogSchema = new mongoose.Schema({
    term: { 
        type: String, 
        required: true, 
        lowercase: true, 
        trim: true 
    },
    date: {
        type: Date,
        required: true,
        default: () => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        }
    },
    count: { 
        type: Number, 
        default: 1 
    },
    resultsCount: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    downloads: {
        type: Number,
        default: 0
    }
}, { 
    timestamps: true 
});

// Índice compuesto único para evitar duplicados en el mismo día
SearchLogSchema.index({ term: 1, date: 1 }, { unique: true });
SearchLogSchema.index({ date: -1 });
SearchLogSchema.index({ count: -1 });

module.exports = mongoose.model('SearchLog', SearchLogSchema);