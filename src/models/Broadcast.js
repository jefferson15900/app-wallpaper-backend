const mongoose = require('mongoose');

const BroadcastSchema = new mongoose.Schema({
    requestId: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 500 },
    mode: { type: String, enum: ['global', 'test'], default: 'global' },
    status: { type: String, enum: ['sending', 'completed', 'unknown'], default: 'sending' },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

BroadcastSchema.index({ owner: 1, requestId: 1 }, { unique: true });
BroadcastSchema.index({ owner: 1, createdAt: -1 });
module.exports = mongoose.model('Broadcast', BroadcastSchema);
