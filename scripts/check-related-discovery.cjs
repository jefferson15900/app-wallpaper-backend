// Run: node scripts/check-related-discovery.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { planRelatedDiscovery, mixRelatedDiscovery } = require('../src/utils/relatedDiscovery');
const metadata = require('../src/utils/wallpaperMetadata');

function batch(main, discovery, page, limit, seed) {
    const plan = planRelatedDiscovery(main.length, discovery.length, page, limit, seed);
    return mixRelatedDiscovery(main.slice(plan.mainSkip, plan.mainSkip + plan.mainTake),
        discovery.slice(plan.discoverySkip, plan.discoverySkip + plan.discoveryTake));
}

for (const seed of [1, 4194304, 12582910]) {
    const quotas = new Set();
    const main = Array.from({ length: 120 }, (_, i) => `main-${i}`);
    const discovery = Array.from({ length: 120 }, (_, i) => `discovery-${i}`);
    const seen = new Set();
    for (let page = 1; page <= 8; page++) {
        const items = batch(main, discovery, page, 12, seed);
        const count = items.filter(item => item.startsWith('discovery')).length;
        assert.ok(count === 1 || count === 2);
        quotas.add(count);
        assert.equal(items.length, 12);
        assert.ok(items.slice(0, 3).every(item => item.startsWith('main')));
        assert.deepEqual(batch(main, discovery, page, 12, seed), items);
        items.forEach(item => { assert.ok(!seen.has(item)); seen.add(item); });
    }
    assert.equal(quotas.size, 2, 'quota varies across batches');
}
// Exhausted pools and partial final batches must not skip or repeat any item.
for (const [mainCount, discoveryCount] of [[30, 1], [1, 30], [0, 9], [9, 0], [0, 0]]) {
    const main = Array.from({ length: mainCount }, (_, i) => `m-${i}`);
    const discovery = Array.from({ length: discoveryCount }, (_, i) => `d-${i}`);
    const items = Array.from({ length: 32 }, (_, page) => {
        const result = batch(main, discovery, page + 1, 12, 5);
        assert.ok(result.filter(item => item.startsWith('d-')).length <= 2);
        return result;
    }).flat();
    assert.deepEqual(new Set(items), new Set([...main, ...discovery]));
    assert.equal(items.length, mainCount + discoveryCount);
}

function evaluate(expression, item) {
    if (typeof expression === 'string' && expression.startsWith('$')) return item[expression.slice(1)];
    if (Array.isArray(expression)) return expression.map(value => evaluate(value, item));
    if (!expression || typeof expression !== 'object') return expression;
    const [operator, input] = Object.entries(expression)[0];
    const args = evaluate(input, item);
    switch (operator) {
        case '$and': return args.every(Boolean);
        case '$not': return !args[0];
        case '$eq': return args[0] === args[1];
        case '$gt': return args[0] > args[1];
        case '$size': return args.length;
        case '$setIntersection': return [...new Set(args[0])].filter(value => args[1].includes(value));
        default: throw new Error(`Unexpected discovery expression: ${operator}`);
    }
}

async function checkController() {
    const wall = (_id, tags, extra = {}) => ({ _id, tags, status: 'approved', artist: { isActive: true }, ...extra });
    const source = wall('source', ['goku', 'dragon ball', 'anime'], {
        metadata: { characters: ['goku'], franchises: ['dragon ball'], styles: ['anime'] },
    });
    const records = [source,
        ...Array.from({ length: 30 }, (_, i) => wall(`goku-${i}`, source.tags)),
        ...Array.from({ length: 10 }, (_, i) => wall(`vegeta-${i}`, ['vegeta', 'dragon ball', 'anime'])),
        ...Array.from({ length: 10 }, (_, i) => wall(`naruto-${i}`, ['naruto', 'anime'])),
        wall('unrelated', ['landscape']), wall('pending', ['anime'], { status: 'pending' }),
        wall('inactive', ['anime'], { artist: { isActive: false } }),
    ];
    const Wallpaper = {
        findById: () => ({ lean: async () => source }),
        aggregate: async pipeline => {
            const match = pipeline[0].$match;
            const candidates = records.filter(item => item.status === match.status && item._id !== match._id?.$ne
                && item.tags.some(tag => match.tags.$in.includes(tag)) && item.artist.isActive !== false);
            const group = pipeline.find(stage => stage.$group)?.$group;
            if (group?._id === '$tags') return []; // Tag frequency does not affect this pagination check.
            if (group) return [false, true].map(_id => ({ _id,
                count: candidates.filter(item => evaluate(group._id, item) === _id).length }));
            const facet = pipeline.find(stage => stage.$facet)?.$facet;
            assert.ok(facet, 'structured character recommendations use discovery pools');
            return [Object.fromEntries(Object.entries(facet).map(([key, stages]) => {
                let result = candidates;
                for (const stage of stages) {
                    if (stage.$match) result = result.filter(item => evaluate(stage.$match.$expr, item));
                    if (stage.$skip !== undefined) result = result.slice(stage.$skip);
                    if (stage.$limit !== undefined) {
                        assert.ok(stage.$limit > 0);
                        result = result.slice(0, stage.$limit);
                    }
                }
                return [key, result];
            }))];
        },
    };
    const filename = path.join(__dirname, '../src/controllers/wallpaperController.js');
    const code = fs.readFileSync(filename, 'utf8');
    const handler = code.slice(code.indexOf('exports.getRelatedWallpapers ='), code.indexOf('// 🆔 OBTENER UNO POR ID'));
    const exports = {};
    vm.runInNewContext(handler, { exports, Wallpaper, RelatedCache: {}, ...metadata,
        planRelatedDiscovery, mixRelatedDiscovery, console });
    const received = [];
    for (let page = 1; page <= 24; page++) {
        const res = { json: data => { received.push(...data); return data; },
            status: code => { throw new Error(`Controller returned ${code}`); } };
        await exports.getRelatedWallpapers({ params: { id: 'source' }, query: { seed: '0.25', page: String(page) } }, res);
    }
    assert.equal(received.length, 50);
    assert.equal(new Set(received.map(item => item._id)).size, 50);
    assert.ok(received.every(item => !['source', 'pending', 'inactive', 'unrelated'].includes(item._id)));
    assert.ok(received.slice(0, 3).every(item => item._id.startsWith('goku-')));
    assert.ok(received.slice(0, 12).some(item => item._id.startsWith('vegeta-')));
    assert.ok(received.some(item => item._id.startsWith('naruto-')));
}

checkController().then(() => console.log('Related discovery checks passed.')).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
