const { test } = require('node:test');
const assert = require('node:assert/strict');
const WallpaperUpdate = require('../models/WallpaperUpdate');
const UpdateDismissal = require('../models/UpdateDismissal');
const { retentionCutoff, cleanupExpiredUpdates } = require('./updateRetention');

test('retention removes expired publications in batches and their dismissals, preserving recent records', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const cutoff = retentionCutoff(now);
    assert.equal(cutoff.toISOString(), '2026-09-04T12:00:00.000Z');
    const originals = { find: WallpaperUpdate.find, remove: WallpaperUpdate.deleteMany, dismiss: UpdateDismissal.deleteMany };
    let rows = Array.from({ length: 501 }, (_, i) => ({ _id: String(i), createdAt: cutoff }));
    rows.push({ _id: 'recent', createdAt: new Date(cutoff.getTime() + 1) });
    let dismissals = [{ update: '0', createdAt: now }, { update: '500', createdAt: now },
        { update: 'orphan', createdAt: cutoff }, { update: 'recent', createdAt: now }];
    const batchSizes = [];
    WallpaperUpdate.find = filter => {
        assert.deepEqual(filter, { createdAt: { $lte: cutoff } });
        return { select(value) { assert.equal(value, '_id'); return this; },
            limit(value) { assert.equal(value, 500); return this; },
            lean: async () => rows.filter(row => row.createdAt <= cutoff).slice(0, 500) };
    };
    UpdateDismissal.deleteMany = async filter => {
        dismissals = dismissals.filter(row => filter.update
            ? !filter.update.$in.includes(row.update) : row.createdAt > filter.createdAt.$lte);
    };
    WallpaperUpdate.deleteMany = async filter => {
        batchSizes.push(filter._id.$in.length);
        assert.ok(!dismissals.some(row => filter._id.$in.includes(row.update)));
        rows = rows.filter(row => !filter._id.$in.includes(row._id) || row.createdAt > filter.createdAt.$lte);
    };
    try {
        await cleanupExpiredUpdates(now);
        assert.deepEqual(batchSizes, [500, 1]);
        assert.deepEqual(rows.map(row => row._id), ['recent']);
        assert.deepEqual(dismissals.map(row => row.update), ['recent']);
        await cleanupExpiredUpdates(now);
        assert.deepEqual(batchSizes, [500, 1]);
    } finally {
        WallpaperUpdate.find = originals.find;
        WallpaperUpdate.deleteMany = originals.remove;
        UpdateDismissal.deleteMany = originals.dismiss;
    }
});

test('a failed dismissal cleanup leaves the publication available for a later cleanup retry', async () => {
    const originals = { find: WallpaperUpdate.find, remove: WallpaperUpdate.deleteMany, dismiss: UpdateDismissal.deleteMany };
    let deleted = false;
    WallpaperUpdate.find = () => ({ select() { return this; }, limit() { return this; }, lean: async () => [{ _id: 'expired' }] });
    UpdateDismissal.deleteMany = async () => { throw new Error('database unavailable'); };
    WallpaperUpdate.deleteMany = async () => { deleted = true; };
    try {
        await assert.rejects(cleanupExpiredUpdates(), /database unavailable/);
        assert.equal(deleted, false);
    } finally {
        WallpaperUpdate.find = originals.find;
        WallpaperUpdate.deleteMany = originals.remove;
        UpdateDismissal.deleteMany = originals.dismiss;
    }
});
