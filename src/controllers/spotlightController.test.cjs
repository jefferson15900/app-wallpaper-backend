// Run: node --test src/controllers/spotlightController.test.cjs
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
const Spotlight = require('../models/Spotlight');
const coverStorage = require('../services/spotlightCoverStorage');

test('banner routes preserve individual highlights and serve exact-tag collections safely', async t => {
    const originals = { user: User.findById, active: User.findByIdAndUpdate, wallpaper: Wallpaper.findById,
        findWallpapers: Wallpaper.find, find: Spotlight.find, create: Spotlight.create, one: Spotlight.findOne,
        remove: Spotlight.findByIdAndDelete, upload: coverStorage.upload, removeCover: coverStorage.remove, secret: process.env.JWT_SECRET };
    const id = 'a'.repeat(24), admin = 'b'.repeat(24);
    const approved = { _id: id, status: 'approved', imageUrl: 'https://example.test/cover.jpg', type: 'image' };
    const banners = [];
    let records = [];
    let failSave = false;
    const uploads = [], removedCovers = [];
    coverStorage.upload = async buffer => {
        uploads.push(buffer);
        return { secure_url: 'https://example.test/uploaded-cover.jpg', public_id: 'banner_covers/uploaded' };
    };
    coverStorage.remove = async value => { removedCovers.push(value); };
    function query(items) {
        let skip = 0, limit = items.length;
        return { populate() { return this; }, sort() { return this; }, skip(value) { skip = value; return this; },
            limit(value) { limit = value; return this; }, then(resolve, reject) { return Promise.resolve(items.slice(skip, skip + limit)).then(resolve, reject); } };
    }
    User.findById = async user => ({ role: user === admin ? 'admin' : 'user' });
    User.findByIdAndUpdate = async () => ({});
    Wallpaper.findById = async value => value === id ? approved : null;
    Wallpaper.find = filter => {
        assert.equal(filter.status, 'approved');
        return query(records.filter(record => record.status === filter.status && record.tags.some(tag => filter.tags.test(tag))));
    };
    Spotlight.create = async value => {
        if (failSave) throw new Error('Database unavailable');
        const document = { ...value, _id: (banners.length + 1).toString(16).padStart(24, '0'), createdAt: new Date() };
        banners.push(document); return document;
    };
    Spotlight.findOne = async filter => banners.find(banner => banner._id === filter._id && banner.targetType === filter.targetType);
    Spotlight.find = filter => {
        const recent = banner => banner.createdAt >= (filter.createdAt || filter.$or[1].createdAt).$gte;
        return query(banners.filter(banner => filter.$or ? banner.targetType === 'collection' || recent(banner)
            : banner.targetType !== 'collection' && recent(banner)).map(banner => ({ ...banner, wallpaperId: banner.wallpaperId === id ? approved : undefined })));
    };
    Spotlight.findByIdAndDelete = async value => { const index = banners.findIndex(banner => banner._id === value); return index < 0 ? null : banners.splice(index, 1)[0]; };
    process.env.JWT_SECRET = 'isolated-banner-test';
    const filename = path.join(__dirname, '../routes/wallpaperRoutes.js');
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(filename, 'utf8'), { module, require: name => {
        if (name.startsWith('../controllers/') && name !== '../controllers/spotlightController') return new Proxy({}, { get: () => (req, res) => res.sendStatus(501) });
        if (name === '../config/cloudinary') return { uploadCloud: { array: () => (req, res, next) => next() } };
        return localRequire(name);
    } });
    const app = express(); app.use(express.json()); app.use('/wallpapers', module.exports);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/wallpapers`;
    const headers = user => user ? { 'x-auth-token': jwt.sign({ user: { id: user } }, process.env.JWT_SECRET) } : {};
    const publish = (body, user = admin) => fetch(`${base}/admin/spotlight`, { method: 'POST', headers: { ...headers(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const draft = { targetType: 'collection', coverKind: 'halloween', collectionTag: '#Halloween', title: 'Noche de terror',
        typography: 'halloween', copy: { es: { title: 'Noche de terror' }, en: { title: 'Spooky night' } } };
    const uploadCover = (body, mime = 'image/jpeg', size = 4, user = admin) => {
        const form = new FormData(); form.append('draft', JSON.stringify(body));
        form.append('cover', new Blob([new Uint8Array(size)], { type: mime }), 'custom-cover.jpg');
        return fetch(`${base}/admin/spotlight`, { method: 'POST', headers: headers(user), body: form });
    };
    try {
        await t.test('only an authenticated admin can publish or remove banners', async () => {
            assert.equal((await publish(draft, null)).status, 401);
            assert.equal((await publish(draft, id)).status, 403);
            assert.equal((await fetch(`${base}/admin/spotlight/${id}`, { method: 'DELETE', headers: headers(id) })).status, 403);
            assert.equal(banners.length, 0);
        });
        await t.test('legacy requests work and collection translations and font are saved', async () => {
            assert.equal((await publish({ wallpaperId: id, title: 'Wallpaper' })).status, 201);
            const response = await publish(draft);
            assert.equal(response.status, 201);
            const saved = await response.json();
            assert.equal(saved.collectionTag, 'halloween');
            assert.equal(saved.copy.en.title, 'Spooky night');
            assert.equal(saved.typography, 'halloween');
            assert.equal(saved.wallpaperId, undefined);
        });
        await t.test('invalid fields are rejected without saving', async () => {
            const previous = banners.length;
            for (const body of [null, {}, { ...draft, collectionTag: {} }, { ...draft, collectionTag: '###' },
                { ...draft, typography: 'arbitrary-font' }, { ...draft, title: 'x'.repeat(91) },
                { ...draft, copy: { en: { title: {} } } }, { ...draft, targetType: 'other' },
                { ...draft, coverKind: 'url', coverUrl: 'http://example.test/a.jpg' },
                { ...draft, coverKind: 'url', coverUrl: 'https://user:password@example.test/a.jpg' },
                { title: 'Invalid wallpaper', wallpaperId: 'bad' }]) {
                assert.equal((await publish(body)).status, 400, JSON.stringify(body));
            }
            approved.status = 'pending';
            assert.equal((await publish({ wallpaperId: id, title: 'Pending' })).status, 404);
            approved.status = 'approved'; approved.type = 'video';
            assert.equal((await publish({ wallpaperId: id, title: 'Video' })).status, 400);
            approved.type = 'image';
            assert.equal(banners.length, previous);
        });
        await t.test('gallery covers require admin, validate before upload and clean up on save failure or removal', async () => {
            const body = { ...draft, coverKind: 'upload' };
            assert.equal((await uploadCover(body, 'image/jpeg', 4, id)).status, 403);
            assert.equal((await uploadCover(body, 'video/mp4')).status, 400);
            assert.equal((await uploadCover(body, 'image/jpeg', 10 * 1024 * 1024 + 1)).status, 413);
            assert.equal((await uploadCover({ ...body, collectionTag: '' })).status, 400);
            assert.equal(uploads.length, 0);
            assert.equal((await publish(body)).status, 400);
            failSave = true;
            assert.equal((await uploadCover(body)).status, 500);
            assert.equal(uploads.length, 1); assert.deepEqual(removedCovers, ['banner_covers/uploaded']);
            failSave = false;
            const response = await uploadCover(body);
            assert.equal(response.status, 201);
            const saved = await response.json();
            assert.equal(saved.coverKind, 'url');
            assert.equal(saved.coverUrl, 'https://example.test/uploaded-cover.jpg');
            assert.equal(saved.coverPublicId, 'banner_covers/uploaded');
            assert.equal(saved.wallpaperId, undefined);
            assert.equal((await fetch(`${base}/admin/spotlight/${saved._id}`, { method: 'DELETE', headers: headers(admin) })).status, 200);
            assert.equal(removedCovers.length, 2);
        });
        await t.test('old apps only receive individual highlights; collections do not expire after 24 hours', async () => {
            assert.equal((await (await fetch(`${base}/spotlight`)).json()).length, 1);
            banners[1].createdAt = new Date(Date.now() - 86400000 * 10);
            const response = await fetch(`${base}/spotlight?format=2`);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.equal((await response.json()).length, 2);
        });
        await t.test('gallery filters exact approved tags, paginates and includes newly published content', async () => {
            const banner = banners[1];
            records = Array.from({ length: 22 }, (_, index) => ({ _id: String(index), tags: ['halloween'], status: 'approved' }));
            records[0].images = [{ assetId: 'summer', metadata: { extraTags: ['summer'] } },
                { assetId: 'spooky', metadata: { extraTags: ['halloween'] } }];
            records.push({ _id: 'pending', tags: ['halloween'], status: 'pending' }, { _id: 'different', tags: ['halloween party'], status: 'approved' });
            const url = `${base}/spotlight/${banner._id}/wallpapers`;
            const first = await (await fetch(url)).json();
            assert.equal(first.items.length, 20); assert.equal(first.hasMore, true);
            assert.equal(first.items[0].matchedAssetId, 'spooky');
            const second = await (await fetch(`${url}?page=2`)).json();
            assert.deepEqual(second.items.map(item => item._id), ['20', '21']); assert.equal(second.hasMore, false);
            records.push({ _id: 'new', tags: ['HALLOWEEN'], status: 'approved' });
            assert.equal((await (await fetch(`${url}?page=2`)).json()).items.length, 3);
            banner.collectionTag = 'c++'; records = [{ _id: 'literal', tags: ['c++'], status: 'approved' }, { _id: 'wrong', tags: ['cccc'], status: 'approved' }];
            assert.deepEqual((await (await fetch(url)).json()).items.map(item => item._id), ['literal']);
            records = []; assert.deepEqual((await (await fetch(url)).json()).items, []);
            assert.equal((await fetch(`${base}/spotlight/invalid/wallpapers`)).status, 400);
            assert.equal((await fetch(`${base}/admin/spotlight/${banner._id}`, { method: 'DELETE', headers: headers(admin) })).status, 200);
            assert.equal((await fetch(url)).status, 404);
            assert.equal(banners.length, 1);
        });
    } finally {
        Object.assign(User, { findById: originals.user, findByIdAndUpdate: originals.active });
        Object.assign(Wallpaper, { findById: originals.wallpaper, find: originals.findWallpapers });
        Object.assign(Spotlight, { find: originals.find, create: originals.create, findOne: originals.one, findByIdAndDelete: originals.remove });
        Object.assign(coverStorage, { upload: originals.upload, remove: originals.removeCover });
        if (originals.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originals.secret;
        await new Promise(resolve => server.close(resolve));
    }
});
