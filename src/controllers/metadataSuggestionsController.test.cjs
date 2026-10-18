// Run: node --test src/controllers/metadataSuggestionsController.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

// Evaluate the emitted Mongo projection against fixtures, including missing vs explicit empty arrays.
function evaluate(value, doc, variables = {}) {
    if (typeof value === 'string' && value.startsWith('$')) {
        const variable = value.startsWith('$$');
        return value.slice(variable ? 2 : 1).split('.').reduce((item, key) => item?.[key], variable ? variables : doc);
    }
    if (Array.isArray(value)) return value.map(item => evaluate(item, doc, variables));
    if (!value || typeof value !== 'object' || !Object.keys(value).length) return value;
    const [operator, input] = Object.entries(value)[0];
    const run = item => evaluate(item, doc, variables);
    switch (operator) {
        case '$ifNull': return run(input[0]) ?? run(input[1]);
        case '$cond': return run(input[0]) ? run(input[1]) : run(input[2]);
        case '$gt': return run(input[0]) > run(input[1]);
        case '$size': return run(input).length;
        case '$setUnion': return [...new Set(run(input).flat())];
        case '$reduce': return run(input.input).reduce((previous, current) => evaluate(input.in, doc, { ...variables, value: previous, this: current }), run(input.initialValue));
        default: throw new Error(`Unsupported operator: ${operator}`);
    }
}

function harness(records) {
    let calls = 0, fail = false;
    const model = { aggregate(pipeline) {
        calls++;
        return { async option(options) {
            assert.equal(options.maxTimeMS, 5000);
            if (fail) throw new Error('database unavailable');
            const counts = new Map();
            for (const doc of records.filter(doc => doc.status === pipeline[0].$match.status)) {
                for (const value of evaluate(pipeline[1].$project.values, doc)) counts.set(value, (counts.get(value) || 0) + 1);
            }
            return [...counts].map(([_id, count]) => ({ _id, count }));
        } };
    } };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', readFileSync(`${__dirname}/metadataSuggestionsController.js`, 'utf8'))(
        name => name === '../models/Wallpaper' ? model : require('../utils/wallpaperMetadata'), module, module.exports);
    return { calls: () => calls, fail(value) { fail = value; }, async search(field, q) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await module.exports.searchMetadataSuggestions({ query: { field, q } }, res);
        return res;
    } };
}

test('suggestions use only their approved effective field and respect manual empty overrides', async () => {
    const h = harness([
        { status: 'approved', metadata: { colors: ['azul'], characters: ['blue fairy'] } },
        { status: 'approved', metadata: { colors: ['red'] }, images: [{ metadata: { colors: ['blue'] } }, { aiMetadata: { colors: ['green'] } }] },
        { status: 'approved', metadata: { colors: ['green'] }, images: [{ metadata: { colors: [] }, aiMetadata: { colors: ['blueberry'] } }] },
        { status: 'approved', images: [{ aiMetadata: { colors: ['blue gray'] } }] },
        { status: 'pending', metadata: { colors: ['blue secret'] } },
        { status: 'rejected', metadata: { colors: ['blue hidden'] } },
    ]);
    assert.deepEqual((await h.search('colors', 'bl')).body, ['blue', 'blue gray']);
    assert.deepEqual((await h.search('colors', 'azu')).body, ['blue']);
    assert.deepEqual((await h.search('colors', 'green')).body, []);
    assert.deepEqual((await h.search('characters', 'bl')).body, ['blue fairy']);
    assert.equal(h.calls(), 2, 'successive queries reuse each field vocabulary');
});

test('all seven fields are supported; literal queries and invalid input cannot alter the pipeline', async () => {
    const fields = require('../utils/wallpaperMetadata').METADATA_FIELDS;
    const h = harness([{ status: 'approved', metadata: Object.fromEntries(fields.map(field => [field, ['pokemon']])) }]);
    for (const field of fields) assert.deepEqual((await h.search(field, 'Poké')).body, ['pokemon']);
    assert.deepEqual((await h.search('extraTags', '.*')).body, []);
    assert.deepEqual((await h.search('colors', ' ')).body, []);
    for (const [field, q] of [['images', 'a'], ['colors', ['blue']], ['colors', 'a'.repeat(81)], ['colors', 'a\n']]) {
        assert.equal((await h.search(field, q)).code, 400);
    }
    assert.equal(h.calls(), 7);
});

test('vocabulary errors allow retry and successful responses contain at most twelve values', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => ({ status: 'approved', metadata: { franchises: [`series ${i}`] } })));
    h.fail(true);
    assert.equal((await h.search('franchises', 'series')).code, 503);
    h.fail(false);
    const result = await h.search('franchises', 'series');
    assert.equal(result.code, 200);
    assert.equal(result.body.length, 12);
    assert.equal(h.calls(), 2);
});
