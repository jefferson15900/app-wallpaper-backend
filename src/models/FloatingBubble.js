const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FloatingBubbleSchema = new Schema({
    wallpaperId: { type: Schema.Types.ObjectId, ref: 'Wallpaper', required: true },
    title: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FloatingBubble', FloatingBubbleSchema);
