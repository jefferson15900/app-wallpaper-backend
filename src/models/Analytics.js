const mongoose = require('mongoose');

// Kept independently of wallpapers: deleting content must not erase history.
const activitySchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    day: { type: Date, required: true },
});
activitySchema.index({ day: 1, deviceId: 1 }, { unique: true });

const searchSchema = new mongoose.Schema({
    searchId: { type: String, required: true, unique: true },
    term: { type: String, required: true },
    resultsCount: { type: Number, required: true },
    resultsScope: { type: String, enum: ['first_page'] },
    searchVersion: String,
    searchMode: { type: String, enum: ['exact', 'fuzzy'] },
    mediaType: { type: String, enum: ['all', 'image', 'video'] },
    serverDurationMs: { type: Number, min: 0 },
    clientDurationMs: { type: Number, min: 0, max: 120000 },
    shownPositions: { type: [Number], default: undefined },
    openedPositions: { type: [Number], default: undefined },
    bestOpenedPosition: { type: Number, min: 1, max: 100 },
    opened: { type: Boolean, default: false },
    downloaded: { type: Boolean, default: false },
    liked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});
searchSchema.index({ createdAt: 1, term: 1 });

const downloadSchema = new mongoose.Schema({
    wallpaperId: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now },
});
downloadSchema.index({ createdAt: 1, wallpaperId: 1 });

const stateSchema = new mongoose.Schema({
    _id: { type: String, default: 'dashboard' },
    startedAt: { type: Date, required: true },
});

module.exports = {
    DailyActivity: mongoose.model('DailyActivity', activitySchema),
    SearchSession: mongoose.model('SearchSession', searchSchema),
    DownloadEvent: mongoose.model('DownloadEvent', downloadSchema),
    AnalyticsState: mongoose.model('AnalyticsState', stateSchema),
};
