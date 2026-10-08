// Run: node --test src/controllers/pendingReviewController.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');

test('pending edits require admin, validate metadata and never change approval or files', async () => {
    const original = { user: User.findById, tracking: User.findByIdAndUpdate,
        update: Wallpaper.findOneAndUpdate, exists: Wallpaper.exists, secret: process.env.JWT_SECRET };
    const admin = 'a'.repeat(24), member = 'b'.repeat(24), id = 'c'.repeat(24);
    const record = { _id: id, tags: ['old'], price: 0, isPremium: false, status: 'pending', imageUrl: 'original.jpg', artist: { username: 'artist' } };
    let writes = 0;
    process.env.JWT_SECRET = 'isolated-review-edit-test';
    User.findById = async userId => ({ role: userId === admin ? 'admin' : 'user' });
    User.findByIdAndUpdate = async () => ({});
    Wallpaper.findOneAndUpdate = (filter, update, options) => {
        writes++;
        assert.equal(filter.status, 'pending');
        assert.deepEqual(options, { new: true, runValidators: true });
        return { populate: async () => {
            if (filter._id !== record._id || record.status !== 'pending') return null;
            Object.assign(record, update.$set);
            return { ...record };
        } };
    };
    Wallpaper.exists = async filter => filter._id === id;
    // Mount the shipped admin route with real auth/admin middleware, isolating unrelated handlers/services.
    const routePath = path.join(__dirname, '../routes/adminRoutes.js');
    const localRequire = createRequire(routePath);
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(routePath, 'utf8'), { module, require: name => {
        if (name === '../controllers/adminController') return new Proxy({}, { get: () => (req, res) => res.sendStatus(501) });
        if (name === '../config/cloudinary') return { uploadCloud: { array: () => (req, res, next) => next() } };
        return localRequire(name);
    } });
    const app = express();
    app.use(express.json()); app.use('/admin', module.exports);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ msg: 'Solicitud no válida' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/admin/pending`;
    const edit = (body, user = admin, wallpaperId = id) => fetch(`${base}/${wallpaperId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json',
            ...(user ? { 'x-auth-token': jwt.sign({ user: { id: user } }, process.env.JWT_SECRET) } : {}) },
        body: JSON.stringify(body),
    });
    try {
        assert.equal((await edit({ tags: [] }, null)).status, 401);
        assert.equal((await edit({ tags: [] }, member)).status, 403);
        const invalid = [{}, null, [], { status: 'approved' }, { imageUrl: 'replacement' },
            { title: 'unsupported' }, { artist: member }, { tags: [{ $ne: '' }] },
            { tags: Array(101).fill('x') }, { price: -1 }, { price: '1' }, { price: null }, { isPremium: 'true' }];
        for (const body of invalid) assert.equal((await edit(body)).status, 400, JSON.stringify(body));
        assert.equal((await edit({ tags: [] }, admin, 'invalid')).status, 400);
        assert.equal(writes, 0);
        const result = await edit({ tags: [' #Anime ', 'ANIME', '  paisaje  ', ''], price: 2.5, isPremium: true });
        assert.equal(result.status, 200);
        const saved = await result.json();
        assert.deepEqual(saved.tags, ['anime', 'paisaje']);
        assert.equal(saved.price, 2.5); assert.equal(saved.isPremium, true);
        assert.equal(saved.status, 'pending'); assert.equal(saved.imageUrl, 'original.jpg');
        const longTag = 'paisaje '.repeat(30).trim();
        const longResult = await edit({ tags: [' #' + longTag.toUpperCase()] });
        assert.equal(longResult.status, 200);
        assert.deepEqual((await longResult.json()).tags, [longTag]);
        assert.equal((await edit({ tags: [] })).status, 200);
        assert.deepEqual(record.tags, []);
        assert.equal(record.price, 2.5); // A partial edit preserves other data.
        assert.equal((await edit({ tags: [] }, admin, 'd'.repeat(24))).status, 404);
        record.status = 'approved';
        assert.equal((await edit({ price: 99 })).status, 409);
        assert.equal(record.price, 2.5);
        record.status = 'rejected';
        assert.equal((await edit({ isPremium: false })).status, 409);
        assert.equal(record.isPremium, true);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        User.findById = original.user; User.findByIdAndUpdate = original.tracking;
        Wallpaper.findOneAndUpdate = original.update; Wallpaper.exists = original.exists;
        if (original.secret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original.secret;
    }
});
