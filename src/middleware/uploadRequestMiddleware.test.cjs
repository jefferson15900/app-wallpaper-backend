// Run: node --test src/middleware/uploadRequestMiddleware.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function harness() {
    const records = [];
    const removed = [];
    let count = 0;
    let aiJobs = 0;
    let counterFails = false;
    let verified = true;
    class Wallpaper {
        constructor(data) { Object.assign(this, data, { _id: randomUUID() }); }
        async save() {
            if (this.uploadRequestId && records.some(item => item.artist === this.artist && item.uploadRequestId === this.uploadRequestId)) {
                throw Object.assign(new Error('duplicate'), { code: 11000 });
            }
            records.push(this);
        }
        static async init() {}
        static findOne(query) {
            return { lean: async () => records.find(item => item.artist === query.artist && item.uploadRequestId === query.uploadRequestId) || null };
        }
    }
    const User = {
        findById: () => ({ lean: async () => ({ role: 'artist', isVerified: verified }) }),
        findByIdAndUpdate: async () => {
            if (counterFails) throw new Error('counter unavailable');
            count++;
        },
    };
    const cloudinary = { uploader: { destroy: async id => { removed.push(id); } } };
    function load(relative) {
        const filename = path.resolve(__dirname, relative);
        const module = { exports: {} };
        const dependencies = name => {
            if (name === '../models/Wallpaper') return Wallpaper;
            if (name === '../models/User') return User;
            if (name === '../config/cloudinary') return { cloudinaryPrimary: cloudinary, cloudinarySecondary: cloudinary };
            if (name === '../config/tags') return { cleanTags: tags => tags };
            if (name === '../utils/tagResolver') return { resolveTagsArray: async tags => tags };
            if (name === '../services/aiQueue') return { addJob: () => { aiJobs++; } };
            return {};
        };
        const run = vm.runInThisContext(`(function(require, module, exports, console) { ${readFileSync(filename, 'utf8')}\n})`, { filename });
        run(dependencies, module, module.exports, { log() {}, error() {} });
        return module.exports;
    }
    const middleware = load('uploadRequestMiddleware.js');
    const controller = load('../controllers/wallpaperController.js').uploadWallpaper;
    const request = (id = randomUUID(), artist = 'artist-one', publicId = randomUUID()) => ({
        get: name => name === 'x-upload-id' ? id : undefined,
        user: { id: artist },
        body: { tags: 'anime,oscuro', useAI: 'false' },
        files: [{ mimetype: 'image/jpeg', path: `https://example.invalid/${publicId}.jpg`, filename: publicId }],
    });
    const response = () => ({
        statusCode: 200, headersSent: false, data: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.headersSent = true; this.data = data; return this; },
    });
    const submit = async req => {
        const res = response();
        let proceed = false;
        await middleware(req, res, () => { proceed = true; });
        if (proceed) await controller(req, res);
        return res;
    };
    return {
        records, removed, request, response, middleware, controller, submit,
        count: () => count, aiJobs: () => aiJobs,
        failCounter: () => { counterFails = true; },
        unverify: () => { verified = false; },
    };
}

test('individual requests create independently reviewable pending wallpapers with shared tags', async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) assert.equal((await h.submit(h.request())).statusCode, 200);
    assert.equal(h.records.length, 3);
    assert.equal(h.count(), 3);
    assert.equal(h.aiJobs(), 0);
    h.records.forEach(item => {
        assert.equal(item.status, 'pending');
        assert.equal(item.images.length, 1);
        assert.deepEqual(item.tags, ['anime', 'oscuro']);
    });
});

test('lost-response retry returns the saved wallpaper before uploading again; keys are user-scoped', async () => {
    const h = harness();
    const id = randomUUID();
    const first = await h.submit(h.request(id));
    const retried = await h.submit(h.request(id.toUpperCase()));
    assert.equal(retried.data._id, first.data._id);
    assert.equal(h.records.length, 1);
    assert.equal(h.count(), 1);
    await h.submit(h.request(id, 'artist-two'));
    assert.equal(h.records.length, 2);
});

test('simultaneous duplicate saves return the original and clean only the extra Cloudinary file', async () => {
    const h = harness();
    const id = randomUUID();
    const first = h.request(id, 'artist-one', 'first-file');
    const duplicate = h.request(id, 'artist-one', 'duplicate-file');
    first.uploadRequestId = duplicate.uploadRequestId = id;
    const responses = [h.response(), h.response()];
    await Promise.all([h.controller(first, responses[0]), h.controller(duplicate, responses[1])]);
    assert.equal(h.records.length, 1);
    assert.equal(h.count(), 1);
    assert.equal(responses[0].data._id, responses[1].data._id);
    assert.deepEqual(h.removed, ['duplicate-file']);
});

test('invalid IDs are rejected and old clients without an ID still upload a carousel', async () => {
    const h = harness();
    const invalid = await h.submit(h.request('bad-id'));
    assert.equal(invalid.statusCode, 400);
    assert.equal(h.records.length, 0);
    const legacy = h.request(null);
    legacy.files.push({ mimetype: 'image/jpeg', path: 'second.jpg', filename: 'second' });
    await h.submit(legacy);
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0].images.length, 2);
});

test('unverified users cannot publish; a counter failure never deletes a saved wallpaper', async () => {
    const denied = harness();
    denied.unverify();
    assert.equal((await denied.submit(denied.request())).statusCode, 403);
    assert.equal(denied.records.length, 0);
    assert.equal(denied.removed.length, 1);
    const saved = harness();
    saved.failCounter();
    assert.equal((await saved.submit(saved.request())).statusCode, 200);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.removed.length, 0);
});

test('the schema enforces uniqueness without excluding legacy documents', () => {
    const Wallpaper = require('../models/Wallpaper');
    const uniqueIndex = Wallpaper.schema.indexes().find(([keys]) => keys.uploadRequestId === 1);
    assert.equal(uniqueIndex[1].unique, true);
    assert.deepEqual(uniqueIndex[1].partialFilterExpression, { uploadRequestId: { $type: 'string' } });
});
