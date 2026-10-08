// Run: node --test src/controllers/searchWallpapers.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const nlp = require('compromise');
const { SYNONYMS } = require('../config/tags');

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
function matches(clause, tags) {
    if (clause.compound) {
        const { must = [], filter = [], mustNot = [], should = [], minimumShouldMatch } = clause.compound;
        const minimum = minimumShouldMatch ?? (must.length || filter.length ? 0 : Number(should.length > 0));
        return [...must, ...filter].every(c => matches(c, tags)) &&
            mustNot.every(c => !matches(c, tags)) && should.filter(c => matches(c, tags)).length >= minimum;
    }
    if (clause.phrase) {
        return tags.some(tag => normalize(tag).includes(normalize(clause.phrase.query)));
    }
    if (clause.text) {
        const { query, fuzzy, matchCriteria = 'any' } = clause.text;
        const indexed = tags.flatMap(tokens);
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
    if (operator === '$filter') return evaluate(input.input, doc, variables)
        .filter(value => evaluate(input.cond, doc, { ...variables, [input.as]: value }));
    if (operator === '$replaceAll') return evaluate(input.input, doc, variables).split(input.find).join(input.replacement);
    const args = evaluate(input, doc, variables);
    switch (operator) {
        case '$size': return args.length;
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

function harness(records, mappings = []) {
    const pipelines = [];
    const queryMatches = (record, filter) => Object.entries(filter).every(([key, value]) =>
        value && typeof value === 'object' && '$in' in value ? value.$in.includes(record[key]) : record[key] === value);
    const TagMap = {
        find: filter => ({ lean: async () => mappings.filter(record => queryMatches(record, filter)) }),
        findOne: filter => ({ lean: async () => mappings.find(record => queryMatches(record, filter)) }),
    };
    const resolver = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${readFileSync(`${__dirname}/../utils/tagResolver.js`, 'utf8')}\n})`)(
        name => name === '../models/TagMap' ? TagMap : { SYNONYMS }, resolver, resolver.exports);
    const controller = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${readFileSync(`${__dirname}/wallpaperController.js`, 'utf8')}\n})`)(name => {
        if (name === 'compromise') return nlp;
        if (name === '../utils/tagResolver') return resolver.exports;
        if (name === '../models/TagMap') return TagMap;
        if (name === '../models/TagSuggestion') return {
            find: filter => ({ limit() { return this; }, lean: async () => [...new Set(records.flatMap(r => r.tags))]
                .filter(tag => new RegExp(filter.tag.$regex, filter.tag.$options).test(tag)).map(tag => ({ tag })) }),
        };
        if (name === '../models/SearchLog') return { findOneAndUpdate: async () => {} };
        if (name === '../services/analyticsService') return {
            recordSearch: async () => {}, quietly: promise => promise.catch(() => {}),
        };
        if (name === '../models/Wallpaper') return { aggregate: async pipeline => {
            pipelines.push(pipeline);
            let result = records.filter(record => matches(pipeline[0].$search, record.tags));
            for (const stage of pipeline.slice(1)) {
                if (stage.$addFields?.matchRatio) result = result.map(record => ({ ...record,
                    matchRatio: evaluate(stage.$addFields.matchRatio, record) }));
                if (stage.$match?.matchRatio) result = result.filter(r => r.matchRatio >= stage.$match.matchRatio.$gte);
                if (stage.$match?.status) result = result.filter(r => r.status === stage.$match.status &&
                    (!stage.$match.type || r.type === stage.$match.type));
                if (stage.$skip !== undefined) result = result.slice(stage.$skip);
                if (stage.$limit !== undefined) result = result.slice(0, stage.$limit);
            }
            return result.map(record => ({ ...record, finalBaseScore: 10 }));
        } };
        return {};
    }, controller, controller.exports);
    return {
        pipelines,
        async search(q, query = {}) {
            const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
            await controller.exports.searchWallpapers({ query: { q, seed: '0.5', ...query } }, res);
            assert.equal(res.code, 200);
            return res.data.map(record => record._id);
        },
    };
}

const wall = (_id, tags, type = 'image', status = 'approved') => ({ _id, tags, type, status, imageUrl: 'fixture' });

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

test('semantic filtering precedes pagination and preserves approval filters', async () => {
    const h = harness([wall('other', ['anime']), wall('first', ['naruto']),
        wall('pending', ['naruto'], 'image', 'pending'), wall('second', ['naruto'])]);
    assert.deepEqual(await h.search('narutoo', { page: '2', limit: '1' }), ['second']);
});
