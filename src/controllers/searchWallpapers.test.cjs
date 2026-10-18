// Run: node --test src/controllers/searchWallpapers.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const nlp = require('compromise');
const mongoose = require('mongoose');

const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokens = text => normalize(text).match(/[a-z0-9]+/g) || [];

function editDistance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    rows[0] = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
                rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
            }
        }
    }
    return rows[a.length][b.length];
}

// Model the emitted Atlas clauses for controlled ASCII fixtures; this does not
// replace integration checks against the deployed index and its analyzer.
function matches(clause, tags, descriptions = []) {
    if (clause.compound) {
        const { must = [], filter = [], mustNot = [], should = [], minimumShouldMatch } = clause.compound;
        const minimum = minimumShouldMatch ?? (must.length || filter.length ? 0 : Number(should.length > 0));
        return [...must, ...filter].every(c => matches(c, tags, descriptions)) &&
            mustNot.every(c => !matches(c, tags, descriptions)) && should.filter(c => matches(c, tags, descriptions)).length >= minimum;
    }
    const paths = [clause.phrase?.path ?? clause.text?.path].flat();
    const values = [...(paths.includes('tags') ? tags : []), ...(paths.includes('searchDescriptions') ? descriptions : [])];
    if (clause.phrase) {
        return values.some(tag => normalize(tag).includes(normalize(clause.phrase.query)));
    }
    if (clause.text) {
        const { query, fuzzy, matchCriteria = 'any' } = clause.text;
        const indexed = values.flatMap(tokens);
        const found = tokens(query).map(word => indexed.some(tag => word === tag || (fuzzy &&
            word.slice(0, fuzzy.prefixLength) === tag.slice(0, fuzzy.prefixLength) &&
            editDistance(word, tag) <= fuzzy.maxEdits)));
        return found.length > 0 && (matchCriteria === 'all' ? found.every(Boolean) : found.some(Boolean));
    }
    throw new Error(`Unsupported Atlas clause: ${JSON.stringify(clause)}`);
}

// Evaluate the previous literal veto too, so the regressions fail on old code.
function evaluate(x, doc, variables = {}) {
    if (typeof x === 'string' && x.startsWith('$$')) return variables[x.slice(2)];
    if (typeof x === 'string' && x.startsWith('$')) return doc[x.slice(1)];
    if (Array.isArray(x)) return x.map(value => evaluate(value, doc, variables));
    if (!x || typeof x !== 'object') return x;
    const [operator, input] = Object.entries(x)[0];
    if (operator === '$meta') return doc.fixtureScore ?? 10;
    if (operator === '$cond') return evaluate(input.if, doc, variables) ? evaluate(input.then, doc, variables) : evaluate(input.else, doc, variables);
    if (operator === '$map') return evaluate(input.input, doc, variables)
        .map(value => evaluate(input.in, doc, { ...variables, [input.as]: value }));
    if (operator === '$trim') return evaluate(input.input, doc, variables).trim();
    if (operator === '$filter') return evaluate(input.input, doc, variables)
        .filter(value => evaluate(input.cond, doc, { ...variables, [input.as]: value }));
    if (operator === '$replaceAll') return evaluate(input.input, doc, variables).split(input.find).join(input.replacement);
    const args = evaluate(input, doc, variables);
    switch (operator) {
        case '$size': return args.length;
        case '$setIntersection': return [...new Set(args[0])].filter(value => args[1].includes(value));
        case '$add': return args.reduce((sum, value) => sum + value, 0);
        case '$multiply': return args.reduce((value, factor) => value * factor, 1);
        case '$mod': return args[0] % args[1];
        case '$toDate': return new mongoose.Types.ObjectId(args).getTimestamp();
        case '$toLong': return Number(args);
        case '$divide': return args[0] / args[1];
        case '$gt': return args[0] > args[1];
        case '$ne': return args[0] !== args[1];
        case '$or': return args.some(Boolean);
        case '$ifNull': return args[0] ?? args[1];
        case '$toLower': return args.toLowerCase();
        case '$indexOfCP': return args[0].indexOf(args[1]);
        default: throw new Error(`Unsupported expression: ${operator}`);
    }
}

function harness(records, mappings = [], ranked = false) {
    const pipelines = [];
    const rankings = [], searches = [];
    const queryMatches = (record, filter) => Object.entries(filter).every(([key, value]) =>
        value && typeof value === 'object' && '$in' in value ? value.$in.includes(record[key]) : record[key] === value);
    const TagMap = {
        find: filter => ({ lean: async () => mappings.filter(record => queryMatches(record, filter)) }),
        findOne: filter => ({ lean: async () => mappings.find(record => queryMatches(record, filter)) }),
    };
    const resolver = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${readFileSync(`${__dirname}/../utils/tagResolver.js`, 'utf8')}\n})`)(
        name => name === '../models/TagMap' ? TagMap : name === './wallpaperMetadata' ? require('../utils/wallpaperMetadata') : require('../config/tags'), resolver, resolver.exports);
    const controller = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${readFileSync(`${__dirname}/wallpaperController.js`, 'utf8')}\n})`)(name => {
        if (name === 'compromise') return nlp;
        if (name === 'mongoose') return mongoose;
        if (name === '../utils/tagResolver') return resolver.exports;
        if (name === '../utils/searchPagination') return require('../utils/searchPagination');
        if (name === '../utils/searchQuery') return require('../utils/searchQuery');
        if (name === '../models/TagMap') return TagMap;
        if (name === '../models/TagSuggestion') return {
            find: filter => ({ limit() { return this; }, lean: async () => [...new Set(records.flatMap(r => r.tags))]
                .filter(tag => new RegExp(filter.tag.$regex, filter.tag.$options).test(tag)).map(tag => ({ tag })) }),
        };
        if (name === '../models/SearchLog') return { findOneAndUpdate: async () => {} };
        if (name === '../services/analyticsService') return {
            recordSearch: async (...args) => { searches.push(args); }, quietly: promise => promise.catch(() => {}),
        };
        if (name === '../models/Wallpaper') return { aggregate: async pipeline => {
            pipelines.push(pipeline);
            let result = records.filter(record => matches(pipeline[0].$search, record.tags, record.searchDescriptions)).map(record => ({ ...record }));
            for (const stage of pipeline.slice(1)) {
                if (ranked && stage.$addFields) {
                    result = result.map(record => ({ ...record, ...Object.fromEntries(Object.entries(stage.$addFields)
                        .map(([key, expression]) => [key, evaluate(expression, record)])) }));
                }
                if (stage.$addFields?.matchRatio) result = result.map(record => ({ ...record,
                    matchRatio: evaluate(stage.$addFields.matchRatio, record) }));
                if (stage.$match?.matchRatio) result = result.filter(r => r.matchRatio >= stage.$match.matchRatio.$gte);
                if (stage.$match?.status) result = result.filter(r => r.status === stage.$match.status &&
                    (!stage.$match.type || r.type === stage.$match.type) && (!stage.$match.price || r.price > 0));
                if (ranked && stage.$match?.['artist.isActive']) result = result.filter(r => r.artistActive !== false);
                if (ranked && stage.$match?.$or) result = result.filter(record => stage.$match.$or.some(filter =>
                    Object.entries(filter).every(([key, expected]) => expected && typeof expected === 'object' && '$lt' in expected
                        ? record[key] < (key === '_id' ? String(expected.$lt) : expected.$lt) : record[key] === expected)));
                if (ranked && stage.$sort) result.sort((a, b) => {
                    for (const [field, direction] of Object.entries(stage.$sort)) {
                        if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * direction;
                    }
                    return 0;
                });
                if (stage.$skip !== undefined) result = result.slice(stage.$skip);
                if (stage.$limit !== undefined) result = result.slice(0, stage.$limit);
                if (ranked && stage.$project) {
                    rankings.push(result.map(record => ({ ...record })));
                    result = result.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => stage.$project[key] !== 0)));
                }
            }
            return ranked ? result : result.map(record => ({ ...record, finalBaseScore: 10 }));
        } };
        if (name === '../utils/wallpaperMetadata') return require('../utils/wallpaperMetadata');
        return {};
    }, controller, controller.exports);
    const responses = [];
    async function request(q, query = {}) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
        await controller.exports.searchWallpapers({ query: { q, seed: '0.5', ...query } }, res);
        responses.push(res.data);
        return res;
    }
    return {
        pipelines, responses, rankings, searches, request,
        async search(q, query = {}) {
            const res = await request(q, query);
            assert.equal(res.code, 200);
            return (res.data.items ?? res.data).map(record => record._id);
        },
    };
}

const wall = (_id, tags, type = 'image', status = 'approved') => ({ _id, tags, type, status, imageUrl: 'fixture' });

test('descriptions retrieve scenes in Spanish while requiring every concept', async () => {
    const scene = description => ({ ...wall(description, ['illustration']), searchDescriptions: [description] });
    const h = harness([scene('A girl stands in the rain on a city street.'),
        scene('A girl stands on a city street.'), scene('A girl stands in the rain in a forest.')]);
    assert.deepEqual(await h.search('una chica bajo la lluvia en la ciudad'), ['A girl stands in the rain on a city street.']);
    assert.deepEqual(await h.search('girl rain city'), ['A girl stands in the rain on a city street.']);
    assert.deepEqual(await h.search('gril rain city'), ['A girl stands in the rain on a city street.']);
});

test('a description keeps a red demon searchable and emits a phrase bonus for red skin', async () => {
    const h = harness([{ ...wall('red', ['fantasy']), searchDescriptions: ['A demon-like man with red skin stands beside a wall.'] },
        { ...wall('blue', ['fantasy']), searchDescriptions: ['A demon-like man with blue skin stands beside a wall.'] }]);
    assert.deepEqual(await h.search('un hombre demonio de color rojo'), ['red']);
    assert.deepEqual(await h.search('hombre demonio piel roja'), ['red']);
    assert.ok(h.pipelines.at(-1)[0].$search.compound.should.some(clause => clause.phrase?.path === 'searchDescriptions'
        && clause.phrase.query.includes('red skin')));
});

test('Spanish translations survive filtering without accepting unrelated colors', async () => {
    const h = harness([wall('blue', ['blue']), wall('green', ['green'])]);
    assert.deepEqual(await h.search('azul'), ['blue']);
    assert.equal(h.pipelines.length, 1);
});

test('TagMap phrase aliases survive filtering even when no original word is stored', async () => {
    const h = harness([wall('space', ['space']), wall('city', ['city'])],
        [{ original: 'espacio exterior', canonical: 'space' }]);
    assert.deepEqual(await h.search('espacio exterior'), ['space']);
});

test('a misspelled character matches through fuzzy but unrelated anime does not', async () => {
    const h = harness([wall('naruto', ['anime', 'naruto']), wall('boruto', ['anime', 'boruto']), wall('anime', ['anime'])]);
    assert.deepEqual(await h.search('narutoo'), ['naruto']);
    assert.ok(JSON.stringify(h.pipelines.at(-1)[0]).includes('fuzzy'));
});

test('fuzzy keeps every requested concept instead of falling back to anime alone', async () => {
    const h = harness([wall('naruto', ['anime', 'naruto']), wall('boruto', ['anime', 'boruto']), wall('naruto-only', ['naruto'])]);
    assert.deepEqual(await h.search('anime narutoo'), ['naruto']);
});

test('translations also work in a combined query and preserve its subject', async () => {
    const h = harness([wall('blue-naruto', ['naruto', 'blue']), wall('red-naruto', ['naruto', 'red']), wall('blue-anime', ['anime', 'blue'])]);
    assert.deepEqual(await h.search('naruto azul'), ['blue-naruto']);
});

test('exact results are returned before enabling fuzzy', async () => {
    const h = harness([wall('naruto', ['naruto']), wall('misspelling', ['narutoo'])]);
    assert.deepEqual(await h.search('naruto'), ['naruto']);
    assert.equal(h.pipelines.length, 1);
    assert.ok(!JSON.stringify(h.pipelines[0][0]).includes('fuzzy'));
});

test('missing subjects never broaden into unrelated anime', async () => {
    const h = harness([wall('boruto', ['anime', 'boruto']), wall('anime', ['anime'])]);
    assert.deepEqual(await h.search('anime narutoo'), []);
});

test('spacing aliases still work', async () => {
    const h = harness([wall('iron-man', ['iron man']), wall('man', ['man'])]);
    assert.deepEqual(await h.search('ironman'), ['iron-man']);
});

test('live intent filters the media type without requiring a live tag', async () => {
    const h = harness([wall('live-naruto', ['naruto'], 'video'), wall('image-naruto', ['naruto'])]);
    assert.deepEqual(await h.search('naruto live'), ['live-naruto']);
});

test('rain is a distinct searchable environment and does not broaden into water', async () => {
    const h = harness([wall('rain', ['city', 'rain']), wall('water', ['city', 'water'])]);
    assert.deepEqual(await h.search('ciudad lluvia'), ['rain']);
});

test('Spanish metadata queries find English-only tags without needing Spanish tags in the catalog', async () => {
    const h = harness([wall('night', ['city', 'night']), wall('day', ['city', 'day'])]);
    assert.deepEqual(await h.search('ciudad noche'), ['night']);
    assert.deepEqual(await h.search('city night'), ['night']);
});

test('semantic filtering precedes pagination and preserves approval filters', async () => {
    const h = harness([wall('other', ['anime']), wall('first', ['naruto']),
        wall('pending', ['naruto'], 'image', 'pending'), wall('second', ['naruto'])]);
    assert.deepEqual(await h.search('narutoo', { page: '2', limit: '1' }), ['second']);
});

test('character phrases inside a longer query preserve the requested color', async () => {
    const h = harness([wall('blue-spider', ['spiderman', 'blue']), wall('red-spider', ['spiderman', 'red']),
        wall('blue-person', ['hombre', 'blue']), wall('blue-spider-alias', ['hombre araña', 'blue'])]);
    assert.deepEqual(await h.search('fondos de HOMBRE ARAÑA azul'), ['blue-spider', 'blue-spider-alias']);
});

test('learned phrase aliases work inside combined queries without dropping other concepts', async () => {
    const h = harness([wall('blue', ['space', 'blue']), wall('red', ['space', 'red']), wall('color', ['blue'])],
        [{ original: 'espacio exterior', canonical: 'space' }]);
    assert.deepEqual(await h.search('espacio exterior azul'), ['blue']);
});

test('phrases containing filler words are recognized before cleanup', async () => {
    const h = harness([wall('blue-moon', ['moon', 'blue']), wall('red-moon', ['moon', 'red'])]);
    assert.deepEqual(await h.search('fondo de luz de luna azul'), ['blue-moon']);
});

test('metadata and legacy flower spellings share one query concept', async () => {
    const h = harness([wall('metadata', ['flower', 'blue']), wall('legacy', ['flowers', 'blue']), wall('red', ['flower', 'red'])]);
    assert.deepEqual(await h.search('flores azules'), ['metadata', 'legacy']);
    assert.deepEqual(await h.search('flower blue'), ['metadata', 'legacy']);
});

test('metadata concepts cannot be broadened by legacy or learned synonym collisions', async () => {
    const h = harness([wall('snow', ['snow']), wall('ice', ['ice']), wall('planet', ['planet']),
        wall('space', ['space']), wall('street', ['street']), wall('city', ['city'])],
        [{ original: 'nieve', canonical: 'ice' }, { original: 'planeta', canonical: 'space' }]);
    assert.deepEqual(await h.search('nieve'), ['snow']);
    assert.deepEqual(await h.search('planeta'), ['planet']);
    assert.deepEqual(await h.search('calle'), ['street']);
});

test('unknown names ending in s are not truncated into unrelated tags', async () => {
    const h = harness([wall('day', ['lunes']), wall('unrelated', ['lun'])]);
    assert.deepEqual(await h.search('lunes'), ['day']);
});

test('fuzzy corrects a first-letter error while preserving the color', async () => {
    const h = harness([wall('blue', ['naruto', 'blue']), wall('red', ['naruto', 'red']), wall('boruto', ['boruto', 'blue'])]);
    assert.deepEqual(await h.search('xaruto azul'), ['blue']);
});

test('spacing alternatives work in either direction within a combined query', async () => {
    const h = harness([wall('joined', ['spiderman', 'blue']), wall('spaced', ['spider man', 'blue']), wall('red', ['spider man', 'red'])]);
    assert.deepEqual(await h.search('spiderman azul'), ['joined', 'spaced']);
    assert.deepEqual(await h.search('spider man azul'), ['joined', 'spaced']);
});

test('translated character phrases identify the matching carousel image', async () => {
    const h = harness([{ ...wall('carousel', ['spiderman', 'blue', 'red']), images: [
        { assetId: 'red', metadata: { characters: ['spiderman'], colors: ['red'] } },
        { assetId: 'blue', metadata: { characters: ['spiderman'], colors: ['blue'] } },
    ] }]);
    assert.deepEqual(await h.search('hombre araña azul'), ['carousel']);
    assert.equal(h.responses.at(-1)[0].matchedAssetId, 'blue');
});

test('queries containing only filler words do not execute an Atlas search', async () => {
    const h = harness([wall('noise', ['fondo'])]);
    assert.deepEqual(await h.search('fondos de pantalla'), []);
    assert.equal(h.pipelines.length, 0);
});

const rankedWall = (index, tags = ['naruto'], fixtureScore = 10, seconds = 0) => ({
    ...wall((1700000000 + seconds).toString(16) + index.toString(16).padStart(16, '0'), tags), fixtureScore,
});

test('description-only results keep cursor continuity and open the matching carousel asset', async () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ ...rankedWall(i + 1, ['illustration']),
        searchDescriptions: ['A girl stands in the rain on a city street.'], images: [
            { assetId: 'unrelated', metadata: { description: 'A forest.' } },
            { assetId: 'scene', aiMetadata: { description: 'A girl stands in the rain on a city street.' } },
        ] }));
    const h = harness(records, [], true);
    const ids = [];
    let cursor;
    do {
        const response = await h.request('chica lluvia ciudad', { pagination: 'cursor', limit: '2', cursor });
        assert.equal(response.code, 200);
        for (const item of response.data.items) {
            assert.equal(item.matchedAssetId, 'scene');
            assert.equal(item.searchDescriptions, undefined);
            assert.deepEqual(item.tags, ['illustration']);
            ids.push(item._id);
        }
        cursor = response.data.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, records.map(record => record._id).reverse());
});

test('cursor pagination exhausts tied scores exactly once with a stable id order', async () => {
    const records = Array.from({ length: 39 }, (_, index) => rankedWall(index + 1));
    const h = harness(records, [], true);
    const ids = [];
    let cursor;
    do {
        const res = await h.request('naruto', { pagination: 'cursor', limit: '7', cursor });
        assert.equal(res.code, 200);
        assert.equal(res.data.hasMore, Boolean(res.data.nextCursor));
        assert.ok(res.data.items.every(item => !('randomizedScore' in item) && !('finalBaseScore' in item)));
        ids.push(...res.data.items.map(item => item._id));
        cursor = res.data.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, records.map(record => record._id).reverse());
    assert.equal(new Set(ids).size, records.length);
    assert.equal(h.searches.length, 1);
    assert.equal(h.searches[0][2], 7);
});

test('variety keeps the existing fifteen percent bound and the cursor freezes its seed', async () => {
    const records = Array.from({ length: 24 }, (_, i) => rankedWall(i + 1, ['naruto'], 10, i * 61));
    const h = harness(records, [], true);
    const expected = await h.search('naruto', { limit: '48', seed: '0.1' });
    assert.ok(h.rankings.at(-1).every(item => item.randomizedScore >= item.finalBaseScore && item.randomizedScore < item.finalBaseScore * 1.15));
    const first = await h.request('naruto', { pagination: 'cursor', limit: '5', seed: '0.1' });
    const second = await h.request('naruto', { pagination: 'cursor', limit: '5', cursor: first.data.nextCursor, seed: '0.9' });
    assert.deepEqual([...first.data.items, ...second.data.items].map(item => item._id), expected.slice(0, 10));
    const otherSeed = await h.search('naruto', { limit: '48', seed: '0.9' });
    assert.notDeepEqual(expected, otherSeed);
});

test('valid lower scored matches are not discarded after the page limit', async () => {
    const h = harness([rankedWall(1, ['naruto'], 100), rankedWall(2, ['naruto'], 1), rankedWall(3, ['naruto'], 1)], [], true);
    const first = await h.request('naruto', { pagination: 'cursor', limit: '2' });
    assert.equal(first.data.items.length, 2);
    assert.equal(first.data.hasMore, true);
    const second = await h.request('naruto', { cursor: first.data.nextCursor, limit: '2' });
    assert.equal(second.data.items.length, 1);
    assert.equal(second.data.hasMore, false);
});

test('removing or inserting a preceding result does not shift the next page', async () => {
    const records = [rankedWall(1), rankedWall(2), rankedWall(3), rankedWall(4)];
    const h = harness(records, [], true);
    const first = await h.request('naruto', { pagination: 'cursor', limit: '2' });
    records.pop();
    records.push(rankedWall(5));
    const second = await h.request('naruto', { cursor: first.data.nextCursor, limit: '2' });
    assert.deepEqual(second.data.items.map(item => item._id), [records[1]._id, records[0]._id]);
    assert.equal(second.data.hasMore, false);
});

test('an exhausted exact search cannot switch to fuzzy on a subsequent cursor or legacy page', async () => {
    const records = [rankedWall(1), rankedWall(2), rankedWall(3, ['narutoo'])];
    const h = harness(records, [], true);
    const first = await h.request('naruto', { pagination: 'cursor', limit: '1' });
    records.shift(); // The only exact result after the cursor is removed.
    const after = h.pipelines.length;
    const second = await h.request('naruto', { cursor: first.data.nextCursor, limit: '1' });
    assert.deepEqual(second.data, { items: [], hasMore: false, nextCursor: null });
    assert.ok(h.pipelines.slice(after).every(pipeline => !JSON.stringify(pipeline[0]).includes('fuzzy')));
    assert.deepEqual(await h.search('naruto', { page: '3', limit: '1' }), []);
    assert.ok(!JSON.stringify(h.pipelines.at(-1)[0]).includes('fuzzy'));
});

test('a fuzzy search keeps its mode while advancing and reports the final page explicitly', async () => {
    const h = harness([rankedWall(1), rankedWall(2), rankedWall(3)], [], true);
    const first = await h.request('narutoo', { pagination: 'cursor', limit: '2' });
    assert.equal(first.data.hasMore, true);
    const before = h.pipelines.length;
    const second = await h.request('narutoo', { cursor: first.data.nextCursor, limit: '2' });
    assert.equal(second.data.items.length, 1);
    assert.equal(second.data.nextCursor, null);
    assert.equal(h.pipelines.length, before + 1);
    assert.ok(JSON.stringify(h.pipelines.at(-1)[0]).includes('fuzzy'));
});

test('malformed cursors and continuations for different queries or filters are rejected before searching', async () => {
    const h = harness([rankedWall(1), rankedWall(2)], [], true);
    const first = await h.request('naruto', { pagination: 'cursor', limit: '1' });
    const cursor = first.data.nextCursor;
    const before = h.pipelines.length;
    for (const query of [{ cursor: 'broken' }, { cursor, type: 'video' }, { cursor, premium: 'true' },
        { cursor: Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url')), score: { $gt: 0 } })).toString('base64url') }]) {
        assert.equal((await h.request('naruto', query)).code, 400);
    }
    assert.equal((await h.request('goku', { cursor })).code, 400);
    assert.equal(h.pipelines.length, before);
});

test('unavailable artists and premium filters are applied before deriving continuation', async () => {
    const h = harness([{ ...rankedWall(1), price: 2 }, { ...rankedWall(2), price: 0 },
        { ...rankedWall(3), price: 2, artistActive: false }], [], true);
    const response = await h.request('naruto', { pagination: 'cursor', limit: '1', premium: 'true' });
    assert.deepEqual(response.data.items.map(item => item._id), [rankedWall(1)._id]);
    assert.equal(response.data.hasMore, false);
});

test('empty queries return the requested envelope while legacy consumers still receive arrays', async () => {
    const h = harness([]);
    assert.deepEqual((await h.request('', { pagination: 'cursor' })).data, { items: [], hasMore: false, nextCursor: null });
    assert.deepEqual((await h.request('fondos de pantalla', { pagination: 'cursor' })).data, { items: [], hasMore: false, nextCursor: null });
    assert.deepEqual((await h.request('')).data, []);
});

test('explicit media filters apply to retrieval, live intent and analytics', async () => {
    const h = harness([wall('image', ['naruto']), wall('video', ['naruto'], 'video')]);
    assert.deepEqual(await h.search('naruto', { type: 'video' }), ['video']);
    assert.equal(h.searches.at(-1)[3].mediaType, 'video');
    assert.deepEqual(await h.search('naruto animado', { type: 'image' }), ['image']);
    assert.deepEqual(await h.search('naruto animado', { type: 'all' }), ['video']);
    assert.equal((await h.request('naruto', { type: 'unknown' })).code, 400);
});
