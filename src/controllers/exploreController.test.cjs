// Run: node --test src/controllers/exploreController.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { sourceRoutes, selectExploreRoutes } = require('../utils/exploreRoutes');

function pathValue(value, path) {
    if (!path.length) return value;
    if (Array.isArray(value)) return value.flatMap(item => pathValue(item, path));
    return pathValue(value?.[path[0]], path.slice(1));
}
function evaluate(value, doc, variables = {}) {
    if (typeof value === 'string' && value.startsWith('$')) {
        return pathValue(value.startsWith('$$') ? variables : doc, value.slice(value.startsWith('$$') ? 2 : 1).split('.'));
    }
    if (Array.isArray(value)) return value.map(item => evaluate(item, doc, variables));
    if (!value || typeof value !== 'object') return value;
    const [operator, input] = Object.entries(value)[0];
    const run = item => evaluate(item, doc, variables);
    switch (operator) {
        case '$ifNull': return run(input[0]) ?? run(input[1]);
        case '$cond': return run(input[0]) ? run(input[1]) : run(input[2]);
        case '$gt': return run(input[0]) > run(input[1]);
        case '$size': return run(input).length;
        case '$isArray': return Array.isArray(run(input));
        case '$or': return run(input).some(Boolean);
        case '$anyElementTrue': return run(input[0]).some(Boolean);
        case '$concatArrays': return run(input).flat();
        case '$in': return run(input[1]).includes(run(input[0]));
        case '$map': return run(input.input).map(term => evaluate(input.in, doc, { ...variables, [input.as]: term }));
        default: return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, run(child)]));
    }
}
function matches(doc, query) {
    return Object.entries(query).every(([key, condition]) => {
        const value = pathValue(doc, key.split('.'));
        if (!condition || typeof condition !== 'object') return value === condition;
        return Object.entries(condition).every(([operator, expected]) => {
            if (operator === '$ne') return value !== expected;
            if (operator === '$type') return typeof value === expected;
            if (operator === '$in') return (Array.isArray(value) ? value : [value]).some(term => expected.includes(term));
            throw new Error(`Unsupported match: ${operator}`);
        });
    });
}
// Execute the emitted field-precedence, carousel and grouping expressions against catalog fixtures.
function aggregate(pipeline, records) {
    let rows = records;
    for (const stage of pipeline) {
        if (stage.$match) rows = rows.filter(row => matches(row, stage.$match));
        else if (stage.$lookup) rows = rows.map(row => ({ ...row, artist: row.artist ? [row.artist] : [] }));
        else if (stage.$unwind) {
            const { path, includeArrayIndex } = typeof stage.$unwind === 'string' ? { path: stage.$unwind } : stage.$unwind;
            rows = rows.flatMap(row => (row[path.slice(1)] || []).map((value, index) => ({ ...row, [path.slice(1)]: value,
                ...(includeArrayIndex ? { [includeArrayIndex]: index } : {}) })));
        } else if (stage.$project) rows = rows.map(row => Object.fromEntries([
            ...(stage.$project._id === undefined ? [['_id', row._id]] : []),
            ...Object.entries(stage.$project).filter(([, expression]) => expression !== 0).map(([key, expression]) =>
                [key, expression === 1 ? row[key] : evaluate(expression, row)]),
        ]));
        else if (stage.$set) rows = rows.map(row => ({ ...row, ...Object.fromEntries(Object.entries(stage.$set)
            .map(([key, expression]) => [key, evaluate(expression, row)])) }));
        else if (stage.$group) {
            const groups = new Map();
            for (const row of rows) {
                const id = evaluate(stage.$group._id, row); const key = JSON.stringify(id);
                const group = groups.get(key) || { _id: id };
                for (const [field, expression] of Object.entries(stage.$group).filter(([field]) => field !== '_id')) {
                    if (expression.$sum) group[field] = (group[field] || 0) + expression.$sum;
                    else if (!(field in group)) group[field] = evaluate(expression.$first, row);
                }
                groups.set(key, group);
            }
            rows = [...groups.values()];
        } else if (stage.$sort) rows.sort((a, b) => {
            for (const [key, direction] of Object.entries(stage.$sort)) {
                const left = pathValue(a, key.split('.')); const right = pathValue(b, key.split('.'));
                if (left < right) return -direction;
                if (left > right) return direction;
            }
            return 0;
        });
        else if (stage.$limit) rows = rows.slice(0, stage.$limit);
        else throw new Error('Unsupported pipeline stage');
    }
    return rows;
}
const id = n => String(n).padStart(24, '0');
const wall = (n, extra = {}) => ({ _id: id(n), status: 'approved', artist: { isActive: true },
    imageUrl: `https://images.test/${n}.jpg`, tags: [], ...extra });
function harness(records) {
    let calls = 0, fail = false;
    const model = {
        findOne: query => ({ select() { return this; }, lean: async () => records.find(row => matches(row, query)) }),
        aggregate: pipeline => ({ option: async ({ maxTimeMS }) => {
            assert.equal(maxTimeMS, 5000); calls++; if (fail) throw new Error('offline');
            return aggregate(pipeline, records);
        } }),
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', readFileSync(`${__dirname}/exploreController.js`, 'utf8'))(
        name => name === '../models/Wallpaper' ? model : require(name), module, module.exports);
    return { calls: () => calls, fail() { fail = true; }, async request(query = {}, source = id(1)) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await module.exports.getExploreOptions({ params: { id: source }, query }, res); return res;
    } };
}

test('active carousel metadata produces available routes and the matching thumbnail, excluding hidden publications', async () => {
    const source = wall(1, { tags: ['pixel art', 'blue', 'car', 'red'], images: [
        { assetId: 'cat', metadata: { styles: ['pixel art'], colors: ['blue'] } },
        { assetId: 'car', metadata: { subjects: ['car'], colors: ['red'] } },
    ] });
    const h = harness([source, wall(2, { tags: ['pixel art', 'blue', 'red'], images: [
        { assetId: 'unrelated', imageUrl: 'https://images.test/red.jpg', metadata: { colors: ['red'] } },
        { assetId: 'matching', imageUrl: 'https://images.test/blue.jpg', metadata: { styles: ['pixel art'], colors: ['blue'] } },
    ] }), wall(3, { status: 'pending', tags: ['pixel art'], metadata: { styles: ['pixel art'] } }),
    wall(4, { artist: { isActive: false }, tags: ['pixel art'], metadata: { styles: ['pixel art'] } }),
    wall(5, { tags: ['car', 'red'], metadata: { subjects: ['car'], colors: ['red'] } })]);
    const first = await h.request({ assetId: 'cat' });
    assert.equal(first.code, 200);
    assert.deepEqual(first.body.map(route => route.term), ['pixel art', 'blue']);
    for (const route of first.body) {
        assert.equal(route.imageUrl, 'https://images.test/blue.jpg');
        assert.equal(route.assetId, 'matching'); assert.equal(route.imageIndex, 1); assert.equal(route.wallpaperId, id(2));
    }
    assert.deepEqual((await h.request({ assetId: 'car' })).body.map(route => route.term), ['car', 'red']);
    assert.equal(h.calls(), 2, 'one aggregate supplies all options and previews per request');
});

test('manual empty fields suppress AI and projected tags; descriptions never become exploration options', async () => {
    const h = harness([wall(1, { tags: ['blue', 'night'], metadata: { colors: ['blue'], environments: ['night'] } }),
        wall(2, { tags: ['blue', 'night'], metadata: { colors: [] }, images: [{
            imageUrl: 'https://images.test/cleared.jpg', aiMetadata: { colors: ['blue'], environments: ['rain'] },
            metadata: { environments: ['night'], descriptionEs: 'secreto' },
        }] })]);
    assert.deepEqual((await h.request()).body.map(route => route.term), ['night']);
    const routes = sourceRoutes({ metadata: { colors: ['green'] }, images: [] }, {
        aiMetadata: { colors: ['blue'], styles: ['anime'] }, metadata: { colors: [], descriptionEn: 'secret' },
    });
    assert.deepEqual(routes, [{ field: 'styles', term: 'anime' }]);
});

test('an unclassified carousel image never inherits projected tags from its classified siblings', async () => {
    const carousel = wall(2, { tags: ['blue'], images: [
        { imageUrl: 'https://images.test/unclassified.jpg' },
        { imageUrl: 'https://images.test/actual-blue.jpg', assetId: 'blue', metadata: { colors: ['blue'] } },
    ] });
    assert.deepEqual(sourceRoutes(carousel, carousel.images[0]), []);
    const h = harness([wall(1, { tags: ['blue'] }), carousel]);
    const result = (await h.request()).body;
    assert.equal(result.length, 1); assert.equal(result[0].imageIndex, 1);
    assert.equal(result[0].imageUrl, 'https://images.test/actual-blue.jpg');
});

test('legacy tags use known equivalents and recent-catalog discovery works without classification', async () => {
    const h = harness([wall(1, { tags: ['car'] }), wall(2, { tags: ['cars'] }), wall(3, { tags: ['car'], type: 'video' })]);
    assert.deepEqual((await h.request()).body.map(route => route.term), ['car']);
    const empty = harness([wall(1), wall(2, { metadata: { styles: ['anime'], colors: ['purple'] } })]);
    assert.deepEqual((await empty.request()).body.map(route => route.term), ['anime', 'purple']);
});

test('source routes alternate fields, deduplicate aliases and prioritize available contextual concepts', () => {
    const source = sourceRoutes({ metadata: { styles: ['anime', 'pixel art'], franchises: ['pokemon'],
        characters: ['meowth', 'pikachu'], colors: ['azul', 'blue'], descriptionEs: 'secret' } });
    assert.deepEqual(source.slice(0, 4).map(route => route.term), ['anime', 'pokemon', 'meowth', 'blue']);
    assert.equal(source.filter(route => route.term === 'blue').length, 1);
    const candidates = [...source].reverse().map(route => ({ ...route, imageUrl: 'https://images.test/a.jpg', wallpaperId: id(2) }));
    const selected = selectExploreRoutes(source, [...candidates, ...candidates]);
    assert.equal(selected.length, 6); assert.deepEqual(selected.map(route => route.term), source.slice(0, 6).map(route => route.term));
});

test('invalid requests, unavailable sources and database failures return recoverable errors', async () => {
    const h = harness([wall(1, { tags: ['anime'] }), wall(2, { status: 'pending' })]);
    for (const query of [{ assetId: {} }, { imageIndex: '-1' }, { imageIndex: '10' }, { imageIndex: ['0'] }, { assetId: 'missing' }, { imageIndex: '1' }]) {
        assert.equal((await h.request(query)).code, 400);
    }
    assert.equal((await h.request({}, 'bad')).code, 400);
    assert.equal((await h.request({}, id(2))).code, 404);
    assert.equal(h.calls(), 0); h.fail(); assert.equal((await h.request()).code, 503);
});
