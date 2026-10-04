const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const WallpaperUpdate = require('../models/WallpaperUpdate');

test('updates API protects publication, filters unavailable content and preserves grouping', async () => {
    const originals = { user: User.findById, tracking: User.findByIdAndUpdate, walls: Wallpaper.find,
        list: WallpaperUpdate.find, detail: WallpaperUpdate.findById, create: WallpaperUpdate.create,
        remove: WallpaperUpdate.findByIdAndDelete, secret: process.env.JWT_SECRET };
    const id = 'a'.repeat(24), other = 'b'.repeat(24), admin = 'c'.repeat(24);
    const available = { _id: id, imageUrl: 'https://example.com/naruto.jpg', artist: { _id: admin }, status: 'approved', type: 'image' };
    const hidden = { _id: other, imageUrl: 'https://example.com/hidden.jpg', artist: null };
    const update = { _id: admin, text: 'Naruto', createdAt: new Date(), coverWallpaper: other, wallpapers: [available, hidden] };
    let created;
    const query = value => ({ sort() { return this; }, skip() { return this; }, limit() { return this; },
        populate() { return this; }, lean: async () => value });
    process.env.JWT_SECRET = 'isolated-update-test-secret';
    User.findById = async userId => ({ role: userId === admin ? 'admin' : 'user' });
    User.findByIdAndUpdate = async () => ({});
    Wallpaper.find = () => query([available]);
    WallpaperUpdate.find = () => query([update]);
    WallpaperUpdate.findById = () => query(update);
    WallpaperUpdate.create = async value => { created = value; return { _id: admin }; };
    WallpaperUpdate.findByIdAndDelete = async () => update;
    const app = express();
    app.use(express.json());
    app.use('/updates', require('./updateRoutes'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/updates`;
    const token = userId => jwt.sign({ user: { id: userId } }, process.env.JWT_SECRET);
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
        const feed = await (await fetch(base)).json();
        assert.equal(feed.items.length, 1);
        assert.equal(feed.items[0].wallpaperCount, 1);
        assert.equal(feed.items[0].coverUrl, available.imageUrl);
        assert.equal(feed.items[0].wallpapers, undefined);
        const detail = await (await fetch(`${base}/${admin}`)).json();
        assert.equal(detail.wallpapers.length, 1);
        assert.equal((await fetch(`${base}/invalid`)).status, 400);
        WallpaperUpdate.findById = () => query(null);
        assert.equal((await fetch(`${base}/${admin}`)).status, 404);
        assert.equal((await fetch(`${base}/${admin}`, { method: 'DELETE' })).status, 401);
        assert.equal((await fetch(`${base}/${admin}`, { method: 'DELETE', headers: { 'x-auth-token': token(admin) } })).status, 200);
    } finally {
        await new Promise(resolve => server.close(resolve));
        User.findById = originals.user; User.findByIdAndUpdate = originals.tracking;
        Wallpaper.find = originals.walls; WallpaperUpdate.find = originals.list;
        WallpaperUpdate.findById = originals.detail; WallpaperUpdate.create = originals.create;
        WallpaperUpdate.findByIdAndDelete = originals.remove;
        if (originals.secret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originals.secret;
    }
});
