const Visitor = require('../models/Visitor');
const { DailyActivity, SearchSession, DownloadEvent, AnalyticsState } = require('../models/Analytics');
const { startOfDay, validSearchId, validDeviceId } = require('../utils/analyticsDates');

const initializeAnalytics = () => AnalyticsState.findOneAndUpdate(
    { _id: 'dashboard' }, { $setOnInsert: { startedAt: new Date() } }, { upsert: true, new: true }
);

async function recordActivity(deviceId, now = new Date()) {
    if (!validDeviceId(deviceId)) return false;
    const update = { $max: { lastActiveAt: now }, $setOnInsert: { createdAt: now } };
    try { await Visitor.updateOne({ deviceId }, update, { upsert: true }); }
    catch (error) {
        if (error.code !== 11000) throw error;
        await Visitor.updateOne({ deviceId }, { $max: { lastActiveAt: now } });
    }
    try {
        await DailyActivity.updateOne({ deviceId, day: startOfDay(now) }, {
            $setOnInsert: { deviceId, day: startOfDay(now) },
        }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    return true;
}

async function recordSearch(searchId, rawTerm, resultsCount) {
    if (!validSearchId(searchId) || typeof rawTerm !== 'string') return;
    const term = rawTerm.trim().toLowerCase().slice(0, 150);
    if (term.length < 2) return;
    try {
        await SearchSession.updateOne({ searchId }, {
            $setOnInsert: { searchId, term, resultsCount, createdAt: new Date() },
        }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
}

async function recordSearchOutcome(searchId, outcome) {
    if (!validSearchId(searchId) || !['opened', 'downloaded', 'liked'].includes(outcome)) return;
    // No upsert: an outcome can only belong to a recorded search. One flag per search
    // prevents reopens, pagination and multiple downloads inflating conversion.
    await SearchSession.updateOne({ searchId }, { $set: { [outcome]: true } });
}

const recordDownload = wallpaperId => DownloadEvent.create({ wallpaperId });
const quietly = promise => promise.catch(error => console.error('[analytics]', error.message));
module.exports = { initializeAnalytics, recordActivity, recordSearch, recordSearchOutcome, recordDownload, quietly };
