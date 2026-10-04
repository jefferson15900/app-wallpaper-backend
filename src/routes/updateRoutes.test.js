const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const WallpaperUpdate = require('../models/WallpaperUpdate');
const UpdateDismissal = require('../models/UpdateDismissal');

test('updates API protects publication, filters unavailable content and preserves grouping', async () => {
    assert.ok(UpdateDismissal.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.update === 1 && options.unique));
    const originals = { user: User.findById, tracking: User.findByIdAndUpdate, walls: Wallpaper.find,
        list: WallpaperUpdate.find, detail: WallpaperUpdate.findById, create: WallpaperUpdate.create,
        remove: WallpaperUpdate.findByIdAndDelete, dismiss: UpdateDismissal.updateOne,
        dismissed: UpdateDismissal.distinct, secret: process.env.JWT_SECRET };
    const id = 'a'.repeat(24), other = 'b'.repeat(24), admin = 'c'.repeat(24);
    const available = { _id: id, imageUrl: 'https://example.com/naruto.jpg', artist: { _id: admin }, status: 'approved', type: 'image' };
    const hidden = { _id: other, imageUrl: 'https://example.com/hidden.jpg', artist: null };
    const update = { _id: admin, text: 'Naruto', createdAt: new Date(), coverWallpaper: other, wallpapers: [available, hidden] };
    let created;
    let sharedDeleteCalled = false;
    const dismissals = new Map();
    const query = value => ({ sort() { return this; }, skip() { return this; }, limit() { return this; },
        populate() { return this; }, lean: async () => value });
    process.env.JWT_SECRET = 'isolated-update-test-secret';
    User.findById = async userId => ({ role: userId === admin ? 'admin' : 'user' });
    User.findByIdAndUpdate = async () => ({});
    Wallpaper.find = () => query([available]);
    WallpaperUpdate.find = filter => {
        assert.ok(filter.createdAt.$gt instanceof Date);
        assert.ok(Math.abs(Date.now() - filter.createdAt.$gt.getTime() - 30 * 86400000) < 1000);
        return query(filter._id.$nin.includes(admin) || update.createdAt <= filter.createdAt.$gt ? [] : [update]);
    };
    WallpaperUpdate.findById = () => query(update);
    WallpaperUpdate.create = async value => { created = value; return { _id: admin }; };
    WallpaperUpdate.findByIdAndDelete = async () => { sharedDeleteCalled = true; return update; };
    UpdateDismissal.distinct = async (field, filter) => {
        assert.equal(field, 'update');
        return [...(dismissals.get(filter.user) || [])];
    };
    UpdateDismissal.updateOne = async (filter, change, options) => {
        assert.deepEqual(change.$setOnInsert, filter);
        assert.equal(options.upsert, true);
        const hidden = dismissals.get(filter.user) || new Set();
        hidden.add(filter.update); dismissals.set(filter.user, hidden);
        return { acknowledged: true };
    };
    const app = express();
    app.use(express.json());
    app.use('/updates', require('./updateRoutes'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/updates`;
    const token = userId => jwt.sign({ user: { id: userId } }, process.env.JWT_SECRET);
    const read = (path = '', userId = id) => fetch(`${base}${path}`, { headers: { 'x-auth-token': token(userId) } });
    const post = (body, userId) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(userId ? { 'x-auth-token': token(userId) } : {}) }, body: JSON.stringify(body) });
    try {
        const draft = { text: ' Naruto ', wallpaperIds: [id, id], coverWallpaperId: id };
        assert.equal((await post(draft)).status, 401);
        assert.equal((await post(draft, id)).status, 403);
        assert.equal((await post({ ...draft, coverWallpaperId: other }, admin)).status, 400);
        assert.equal((await post({ ...draft, wallpaperIds: [id, other] }, admin)).status, 400);
        assert.equal((await post(draft, admin)).status, 201);
        assert.deepEqual(created, { text: 'Naruto', wallpapers: [id], coverWallpaper: id, author: admin });
        assert.equal((await fetch(base)).status, 401);
        assert.equal((await fetch(`${base}/${admin}`)).status, 401);
        const feed = await (await read()).json();
        assert.equal(feed.items.length, 1);
        assert.equal(feed.items[0].wallpaperCount, 1);
        assert.equal(feed.items[0].coverUrl, available.imageUrl);
        assert.equal(feed.items[0].wallpapers, undefined);
        const detail = await (await read(`/${admin}`)).json();
        assert.equal(detail.wallpapers.length, 1);
        const originalDate = update.createdAt;
        update.createdAt = new Date(Date.now() - 30 * 86400000);
        assert.equal((await (await read()).json()).items.length, 0);
        assert.equal((await read(`/${admin}`)).status, 404);
        update.createdAt = new Date(Date.now() - 29 * 86400000);
        assert.equal((await (await read()).json()).items.length, 1);
        assert.equal((await read(`/${admin}`)).status, 200);
        update.createdAt = originalDate;
        assert.equal((await read('/invalid')).status, 400);
        WallpaperUpdate.findById = () => query(null);
        assert.equal((await read(`/${admin}`)).status, 404);
        assert.equal((await fetch(`${base}/${admin}`, { method: 'DELETE' })).status, 401);
        // A regular account can dismiss for itself, but cannot name another account.
        for (let retry = 0; retry < 2; retry++) {
            assert.equal((await fetch(`${base}/${admin}`, { method: 'DELETE', headers: {
                'x-auth-token': token(id), 'Content-Type': 'application/json' }, body: JSON.stringify({ user: other }) })).status, 200);
        }
        assert.equal(dismissals.get(id).size, 1);
        assert.equal(dismissals.has(other), false);
        assert.equal((await (await read()).json()).items.length, 0);
        assert.equal((await (await read('', other)).json()).items.length, 1);
        assert.equal((await (await read('', admin)).json()).items.length, 1);
        assert.equal(sharedDeleteCalled, false);
        assert.equal((await fetch(`${base}/bad`, { method: 'DELETE', headers: { 'x-auth-token': token(id) } })).status, 400);
    } finally {
        await new Promise(resolve => server.close(resolve));
        User.findById = originals.user; User.findByIdAndUpdate = originals.tracking;
        Wallpaper.find = originals.walls; WallpaperUpdate.find = originals.list;
        WallpaperUpdate.findById = originals.detail; WallpaperUpdate.create = originals.create;
        WallpaperUpdate.findByIdAndDelete = originals.remove;
        UpdateDismissal.updateOne = originals.dismiss; UpdateDismissal.distinct = originals.dismissed;
        if (originals.secret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originals.secret;
    }
});
