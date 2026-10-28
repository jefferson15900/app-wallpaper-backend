const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SpotlightSchema = new Schema({
    wallpaperId: { type: Schema.Types.ObjectId, ref: 'Wallpaper', required: function () { return this.coverKind === 'wallpaper'; } },
    targetType: { type: String, enum: ['wallpaper', 'collection'], default: 'wallpaper' },
    collectionTag: { type: String, maxlength: 80 },
    coverKind: { type: String, enum: ['wallpaper', 'halloween', 'url'], default: 'wallpaper' },
    coverUrl: { type: String, maxlength: 2048 },
    coverPublicId: { type: String },
    typography: { type: String, enum: ['normal', 'halloween', 'christmas'], default: 'normal' },
    copy: {
        es: { title: { type: String, maxlength: 90 }, subtitle: { type: String, maxlength: 140 } },
        en: { title: { type: String, maxlength: 90 }, subtitle: { type: String, maxlength: 140 } },
    },
    title: { type: String, required: true },
    subtitle: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Spotlight', SpotlightSchema);
