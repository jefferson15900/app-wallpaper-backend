const mongoose = require('mongoose');

const TagMapSchema = new mongoose.Schema({
    original: { type: String, required: true, unique: true, lowercase: true, trim: true },
    canonical: { type: String, required: true, lowercase: true, trim: true, index: true },
    language: { type: String, default: 'en' }
});

module.exports = mongoose.model('TagMap', TagMapSchema);