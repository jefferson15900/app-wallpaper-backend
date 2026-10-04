const WallpaperUpdate = require('../models/WallpaperUpdate');
const UpdateDismissal = require('../models/UpdateDismissal');

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionCutoff(now = new Date()) {
    return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

async function cleanupExpiredUpdates(now = new Date()) {
    const cutoff = retentionCutoff(now);
    // Bound each query and deletion, including the first run against an older database.
    while (true) {
        const rows = await WallpaperUpdate.find({ createdAt: { $lte: cutoff } })
            .select('_id').limit(500).lean();
        if (!rows.length) break;
        const ids = rows.map(row => row._id);
        // Remove dismissals first so an interrupted run can safely retry the same batch.
        await UpdateDismissal.deleteMany({ update: { $in: ids } });
        await WallpaperUpdate.deleteMany({ _id: { $in: ids }, createdAt: { $lte: cutoff } });
    }
    // Also remove old orphan records left by earlier deletions or concurrent requests.
    await UpdateDismissal.deleteMany({ createdAt: { $lte: cutoff } });
}

function startUpdateRetention() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await cleanupExpiredUpdates(); }
        catch (error) { console.error('[MS] Error al limpiar actualizaciones:', error.message); }
        finally { running = false; }
    };
    void run();
    const timer = setInterval(run, DAY_MS);
    timer.unref();
    return () => clearInterval(timer);
}

module.exports = { RETENTION_DAYS, retentionCutoff, cleanupExpiredUpdates, startUpdateRetention };
