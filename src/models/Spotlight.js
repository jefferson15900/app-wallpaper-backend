const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SpotlightSchema = new Schema({
    wallpaperId: { type: Schema.Types.ObjectId, ref: 'Wallpaper', required: true },
    title: { type: String, required: true },
    subtitle: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Spotlight', SpotlightSchema);
