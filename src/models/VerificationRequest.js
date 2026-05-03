const mongoose = require('mongoose');

const VerificationRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagram: { type: String, required: true },
    portfolio: { type: String }, // Opcional
    samples: [
        { url: String, public_id: String }
    ],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    artTypes: [String],    
    description: String,
});

module.exports = mongoose.model('VerificationRequest', VerificationRequestSchema);