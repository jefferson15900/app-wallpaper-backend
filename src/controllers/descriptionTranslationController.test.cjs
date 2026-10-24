const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('translation requires upload privileges, validates input before inference and exposes recoverable errors', async () => {
    let user = { role: 'artist', isVerified: true }, calls = 0, failure;
    const module = { exports: {} };
    const dependencies = {
        '../models/User': { findById: () => ({ lean: async () => user }) },
        '../services/aiService': { translateDescription: async text => {
            calls++;
            if (failure) throw failure;
            return { descriptionEs: text, descriptionEn: 'A city.' };
        } },
        '../utils/wallpaperMetadata': require('../utils/wallpaperMetadata'),
    };
    new Function('require', 'module', 'exports', readFileSync(`${__dirname}/descriptionTranslationController.js`, 'utf8'))(
        name => { assert.ok(dependencies[name], `Unexpected dependency: ${name}`); return dependencies[name]; }, module, module.exports);
    const request = async body => {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
        await module.exports.translateWallpaperDescription({ user: { id: 'user' }, body }, res);
        return res;
    };
    assert.deepEqual((await request({ descriptionEs: ' Una ciudad. ' })).data, { descriptionEs: 'Una ciudad.', descriptionEn: 'A city.' });
    for (const body of [undefined, {}, { descriptionEs: '' }, { descriptionEs: [] }, { descriptionEs: 'x'.repeat(241) },
        { descriptionEs: 'Una ciudad.', model: 'other' }]) assert.equal((await request(body)).code, 400);
    assert.equal(calls, 1);
    user = { role: 'artist', isVerified: false };
    assert.equal((await request({ descriptionEs: 'Una ciudad.' })).code, 403);
    assert.equal(calls, 1);
    user = { role: 'admin' };
    for (const [error, code] of [[{ status: 429 }, 429], [{ statusCode: 503, message: 'Sin configurar' }, 503], [{ message: 'secret upstream error' }, 502]]) {
        failure = error;
        const response = await request({ descriptionEs: 'Una ciudad.' });
        assert.equal(response.code, code);
        assert.ok(!JSON.stringify(response.data).includes('secret'));
    }
});
