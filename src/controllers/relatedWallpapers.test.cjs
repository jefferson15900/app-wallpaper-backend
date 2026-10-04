// Run: node --test src/controllers/relatedWallpapers.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Evaluate the ranking expressions emitted by the controller, without a database.
function evaluate(value, item) {
    if (typeof value === 'string' && value.startsWith('$')) return item[value.slice(1)];
    if (Array.isArray(value)) return value.map(entry => evaluate(entry, item));
    if (!value || typeof value !== 'object') return value;
    const [operator, input] = Object.entries(value)[0];
    const args = evaluate(input, item);
    switch (operator) {
        case '$in': return args[1].includes(args[0]);
        case '$cond': return args[0] ? args[1] : args[2];
        case '$setIntersection': return [...new Set(args[0])].filter(tag => args[1].includes(tag));
        case '$size': return args.length;
        case '$max': return Math.max(...args);
        case '$sum': return args.reduce((sum, weight) => sum + weight, 0);
        // Also support the previous algorithm so these cases fail against it.
        case '$add': return args.reduce((sum, weight) => sum + weight, 0);
        default: throw new Error(`Unsupported expression: ${operator}`);
    }
}

function harness(records, cache = null) {
    let writtenCache;
    let aggregations = 0;
    const Wallpaper = {
        findById: id => ({ lean: async () => records.find(item => item._id === id) }),
        aggregate: async pipeline => {
            aggregations++;
            const match = pipeline[0].$match;
            const candidates = records.filter(item => item.status === match.status &&
                item.tags.some(tag => match.tags.$in.includes(tag)));
            if (pipeline.some(stage => stage.$group)) {
                const counts = new Map();
                candidates.forEach(item => [...new Set(item.tags)].forEach(tag => {
                    if (match.tags.$in.includes(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
                }));
                return [...counts].map(([_id, count]) => ({ _id, count }));
            }
            let result = candidates.filter(item => item._id !== match._id.$ne).map(item => ({ ...item }));
            for (const stage of pipeline.slice(1)) {
                if (stage.$addFields) {
                    result = result.map(item => ({ ...item, ...Object.fromEntries(
                        Object.entries(stage.$addFields).map(([key, expression]) => [key, evaluate(expression, item)])
                    ) }));
                } else if (stage.$sort) {
                    result.sort((a, b) => {
                        for (const [key, direction] of Object.entries(stage.$sort)) {
                            if (a[key] < b[key]) return -direction;
                            if (a[key] > b[key]) return direction;
                        }
                        return 0;
                    });
                } else if (stage.$match) {
                    result = result.filter(item => item.artist && item.artist.isActive !== false);
                } else if (stage.$skip !== undefined) {
                    result = result.slice(stage.$skip);
                } else if (stage.$limit) {
                    result = result.slice(0, stage.$limit);
                } else if (stage.$project) {
                    result.forEach(item => Object.keys(stage.$project).forEach(key => { delete item[key]; }));
                }
            }
            return result;
        },
    };
    const RelatedCache = {
        findOne: async () => cache,
        findOneAndUpdate: async (filter, update) => { writtenCache = update; },
    };
    const filename = path.join(__dirname, 'wallpaperController.js');
    const module = { exports: {} };
    const run = vm.runInThisContext(`(function(require, module, exports) { ${readFileSync(filename, 'utf8')}\n})`, { filename });
    run(name => {
        if (name === '../models/Wallpaper') return Wallpaper;
        if (name === '../models/RelatedCache') return RelatedCache;
        return {};
    }, module, module.exports);
    return {
        async request(id, query = {}) {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
                json(data) { this.data = data; return this; } };
            await module.exports.getRelatedWallpapers({ params: { id }, query }, res);
            assert.equal(res.statusCode, 200);
            return res.data;
        },
        cache: () => writtenCache,
        aggregations: () => aggregations,
    };
}

const wall = (_id, tags, createdAt = 1, extra = {}) => ({
    _id, tags, createdAt, status: 'approved', artist: { isActive: true }, ...extra,
});
const catalog = () => [
    wall('bayonetta-source', ['bayonetta', 'gaming girl']),
    wall('bayonetta-related', ['bayonetta'], 1),
    wall('peach-source', ['super mario bros', 'princess peach', 'gaming girl']),
    wall('peach-related', ['princess peach'], 1),
    wall('mario', ['super mario bros', 'gaming'], 5),
    wall('luigi', ['super mario bros', 'gaming'], 5),
    wall('nier-new', ['nier automata', 'gaming girl', 'gaming', '2b'], 100),
    wall('nier-other', ['nier automata', 'gaming girl', 'gaming', '2b'], 90),
];

test('Bayonetta takes priority over recent NieR sharing gaming girl, with or without search context', async () => {
    for (const primaryTag of [undefined, 'gaming girl', 'game girl', 'nier automata']) {
        const h = harness(catalog());
        const result = await h.request('bayonetta-source', { primaryTag });
        assert.equal(result[0]._id, 'bayonetta-related');
        assert.ok(result.some(item => item._id === 'nier-new'), 'general matches remain as fallback');
        assert.ok(result.every(item => item._id !== 'bayonetta-source'));
    }
});

test('Peach takes priority over her broader franchise and other gaming characters', async () => {
    const result = await harness(catalog()).request('peach-source', { primaryTag: 'gaming girl' });
    assert.equal(result[0]._id, 'peach-related');
    assert.ok(result.findIndex(item => item._id === 'mario') < result.findIndex(item => item._id === 'nier-new'));
});

test('wallpapers already matching their specific tags continue to lead', async () => {
    const result = await harness(catalog()).request('nier-new', { primaryTag: 'gaming girl' });
    assert.equal(result[0]._id, 'nier-other');
});

test('only a general tag still returns related wallpapers', async () => {
    const result = await harness([...catalog(), wall('general', ['gaming girl'])]).request('general');
    assert.equal(result[0]._id, 'nier-new');
});

test('pagination excludes unavailable wallpapers first and has a stable tie order', async () => {
    const records = [wall('source', ['bayonetta']),
        wall('hidden', ['bayonetta'], 100, { artist: { isActive: false } }),
        wall('pending', ['bayonetta'], 100, { status: 'pending' }),
        wall('a', ['bayonetta']), wall('b', ['bayonetta']), wall('c', ['bayonetta'])];
    const h = harness(records);
    const first = await h.request('source', { limit: '2' });
    const second = await h.request('source', { limit: '2', page: '2' });
    assert.deepEqual([...first, ...second].map(item => item._id), ['c', 'b', 'a']);
    assert.ok(first.every(item => item.strongestTagWeight === undefined && item.weightedTags === undefined));
});

test('old caches are replaced and fresh caches only apply to the same page size', async () => {
    const stale = { snapshot: [wall('cached-nier', ['gaming girl'])], updatedAt: new Date() };
    const h = harness(catalog(), stale);
    assert.equal((await h.request('bayonetta-source'))[0]._id, 'bayonetta-related');
    assert.equal(h.cache().rankingVersion, 2);
    assert.equal(h.cache().limit, 12);
    const fresh = { ...stale, ...h.cache() };
    const cached = harness(catalog(), fresh);
    assert.deepEqual(await cached.request('bayonetta-source'), fresh.snapshot);
    assert.equal(cached.aggregations(), 0);
    const differentSize = harness(catalog(), fresh);
    assert.equal((await differentSize.request('bayonetta-source', { limit: '1' })).length, 1);
    assert.equal(differentSize.aggregations(), 2);
});

test('missing wallpapers, empty tags and malformed context return safely', async () => {
    const h = harness([...catalog(), wall('empty', [])]);
    assert.deepEqual(await h.request('missing'), []);
    assert.deepEqual(await h.request('empty'), []);
    assert.equal((await h.request('bayonetta-source', { primaryTag: ['gaming girl'], limit: '-1' })).length, 1);
});
