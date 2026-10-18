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

async function recordSearch(searchId, rawTerm, resultsCount, measurement = {}) {
    if (!validSearchId(searchId) || typeof rawTerm !== 'string') return;
    const term = rawTerm.trim().toLowerCase().slice(0, 150);
    if (term.length < 2) return;
    try {
        await SearchSession.updateOne({ searchId }, {
            $setOnInsert: { searchId, term, resultsCount, createdAt: new Date(),
                ...(measurement.searchVersion ? { searchVersion: measurement.searchVersion, searchMode: measurement.searchMode,
                    mediaType: measurement.mediaType,
                    serverDurationMs: measurement.serverDurationMs, resultsScope: 'first_page' } : {}),
            },
        }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
}

const validPosition = position => Number.isInteger(position) && position >= 1 && position <= 100;

async function recordSearchMetrics(searchId, measurement) {
    if (!validSearchId(searchId) || !measurement || typeof measurement !== 'object' || Array.isArray(measurement)) { return false; }
    const { positions, clientDurationMs } = measurement;
    if (positions !== undefined && (!Array.isArray(positions) || positions.length > 50 || !positions.every(validPosition))) { return false; }
    if (clientDurationMs !== undefined && (!Number.isFinite(clientDurationMs) || clientDurationMs < 0 || clientDurationMs > 120000)) { return false; }
    // Bounded sets: replaying a batch or revisiting a card cannot inflate exposure.
    if (positions?.length) {
        await SearchSession.updateOne({ searchId }, { $addToSet: { shownPositions: { $each: [...new Set(positions)] } } });
    }
    if (clientDurationMs !== undefined) {
        await SearchSession.updateOne({ searchId, clientDurationMs: { $exists: false } }, { $set: { clientDurationMs } });
    }
    return true;
}

async function recordSearchOutcome(searchId, outcome, position) {
    if (!validSearchId(searchId) || !['opened', 'downloaded', 'liked'].includes(outcome)) return;
    // No upsert: an outcome can only belong to a recorded search. One flag per search
    // prevents reopens, pagination and multiple downloads inflating conversion.
    await SearchSession.updateOne({ searchId }, { $set: { [outcome]: true },
        ...(outcome === 'opened' && validPosition(position) ? {
            $addToSet: { openedPositions: position }, $min: { bestOpenedPosition: position },
        } : {}),
    });
}

const recordDownload = wallpaperId => DownloadEvent.create({ wallpaperId });
const quietly = promise => promise.catch(error => console.error('[analytics]', error.message));
module.exports = { initializeAnalytics, recordActivity, recordSearch, recordSearchMetrics, recordSearchOutcome, recordDownload, quietly };
