const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');

function harness() {
    const reads = [], analytics = [];
    let fail = false;
    const records = Array.from({ length: 4 }, (_, i) => ({ _id: `city${i}`, status: 'approved', imageUrl: `${i}.jpg`, metadata: { subjects: ['city'], environments: ['night'] } }));
    const module = { exports: {} }, local = createRequire(__filename);
    new Function('require', 'module', 'exports', readFileSync(`${__dirname}/discoveryTopicsController.js`, 'utf8'))(name => {
        if (name === '../models/Wallpaper') return { aggregate(pipeline) { reads.push(pipeline); return { option: async () => {
            if (fail) throw new Error('fixture unavailable');
            return records;
        } }; } };
        if (name === '../models/Analytics') return { SearchSession: { aggregate(pipeline) {
            analytics.push(pipeline); return { option: async () => [{ term: 'city night', engagement: 2 }] };
        } } };
        return local(name);
    }, module, module.exports);
    return { reads, analytics, fail: value => { fail = value; }, async get(query) {
        const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
            set(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } };
        await module.exports.getDiscoveryTopics({ query }, res); return res;
    } };
}

test('localized responses share a read-only pool but never share personalized output', async () => {
    const h = harness();
    const es = await h.get({ language: 'es-PE', interests: '[{"field":"subjects","term":"city","score":50}]' });
    const en = await h.get({ language: 'en-US' });
    assert.equal(es.code, 200); assert.equal(en.code, 200);
    assert.equal(es.body.language, 'es'); assert.equal(en.body.language, 'en');
    assert.equal(es.body.topics[0].title, 'Ciudades de noche');
    assert.equal(en.body.topics[0].title, 'Cities at night');
    assert.equal(es.body.topics[0].personalized, true); assert.equal(en.body.topics[0].personalized, false);
    assert.equal(h.reads.length, 1); assert.equal(h.analytics.length, 1);
    assert.equal(es.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(h.reads[0][0], { $match: { status: 'approved' } });
    assert.ok(h.reads[0].some(stage => stage.$match?.['owner.isActive']?.$ne === false));
    const outcomes = h.analytics[0][0].$match;
    assert.equal(outcomes.resultsCount.$gte, 4);
    assert.deepEqual(outcomes.$or, [{ opened: true }, { downloaded: true }, { liked: true }]);
});

test('filters have separate pools, validation runs before IO and failures can be retried', async () => {
    const h = harness();
    for (const query of [{ language: 'fr' }, { type: 'bad' }, { interests: '{}' }, { language: ['es'] }]) assert.equal((await h.get(query)).code, 400);
    assert.equal(h.reads.length, 0);
    h.fail(true); assert.equal((await h.get({})).code, 503);
    h.fail(false); assert.equal((await h.get({})).code, 200);
    await h.get({ type: 'video' });
    assert.equal(h.reads.at(-1)[0].$match.type, 'video');
    assert.equal(h.analytics.at(-1)[0].$match.mediaType, 'video');
});
