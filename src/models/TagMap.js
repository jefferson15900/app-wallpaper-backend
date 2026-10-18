const mongoose = require('mongoose');
const { normalizeTerm } = require('../utils/wallpaperMetadata');

function normalizeAlias(value) {
    return typeof value === 'string' ? normalizeTerm(value) : value;
}

const TagMapSchema = new mongoose.Schema({
    original: { type: String, required: true, unique: true, lowercase: true, trim: true, set: normalizeAlias },
    canonical: { type: String, required: true, lowercase: true, trim: true, index: true, set: normalizeAlias },
    language: { type: String, default: 'en' },
});

module.exports = mongoose.model('TagMap', TagMapSchema);
