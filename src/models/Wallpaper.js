const mongoose = require('mongoose');
const { METADATA_FIELDS } = require('../utils/wallpaperMetadata');
const MetadataSchema = new mongoose.Schema(Object.fromEntries(METADATA_FIELDS.map(field => [field, {
    type: [String], default: undefined,
    validate: values => values.length <= (field === 'extraTags' ? 20 : 8) && values.every(value => value.length <= 80),
}])), { _id: false });
const WallpaperSchema = new mongoose.Schema({
    tags: [{ type: String }],
    manualTags: { type: [String], default: undefined },
    metadata: { type: MetadataSchema, default: undefined },
    metadataVersion: { type: Number, default: undefined },
    metadataRevision: { type: Number, default: 0 },
    imageUrl: { type: String, required: true }, 
    public_id: { type: String, required: true },
    uploadRequestId: { type: String, select: false },
    images: [{
        assetId: { type: String },
        imageUrl: { type: String },
        public_id: { type: String },
        metadata: { type: MetadataSchema, default: undefined },
        aiMetadata: { type: MetadataSchema, default: undefined },
        analysis: {
            status: { type: String, enum: ['not_requested', 'pending', 'processing', 'succeeded', 'failed'] },
            model: String, version: Number, analyzedAt: Date, error: String,
            runId: String, startedAt: Date, leaseUntil: Date,
        },
    }],
    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    downloads: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending'}, 
    isPremium: { type: Boolean, default: false }, 
    isAITagged: { type: Boolean, default: false },
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    price: { type: Number, default: 0 }, 
});

WallpaperSchema.index({ status: 1, createdAt: -1 });
WallpaperSchema.index({ category: 1 });
WallpaperSchema.index({ artist: 1 });
WallpaperSchema.index({ artist: 1, uploadRequestId: 1 }, {
    unique: true,
    partialFilterExpression: { uploadRequestId: { $type: 'string' } }
});
module.exports = mongoose.model('Wallpaper', WallpaperSchema);
