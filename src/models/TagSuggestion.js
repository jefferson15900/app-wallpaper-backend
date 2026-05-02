const mongoose = require('mongoose');

const TagSuggestionSchema = new mongoose.Schema({
    tag:   { type: String, required: true, unique: true, lowercase: true, trim: true },
    count: { type: Number, default: 1 },
}, { timestamps: true });

TagSuggestionSchema.index({ tag: 1, count: -1 });
module.exports = mongoose.model('TagSuggestion', TagSuggestionSchema);