const mongoose = require('mongoose');

const VisitorSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true }, // ID único del celular
    lastActiveAt: { type: Date, default: Date.now },
    lastDownloadAt: { type: Date, default: null },
    isRegistered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

VisitorSchema.index({ createdAt: 1 });
module.exports = mongoose.model('Visitor', VisitorSchema);
