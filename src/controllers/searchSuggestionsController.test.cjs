const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const normalize = require('../utils/wallpaperMetadata').normalizeTerm;
const tokens = term => normalize(term).match(/[a-z0-9]+/g) || [];

function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]; row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + Number(a[i - 1] !== b[j - 1])); previous = old;
        }
    }
    return row[b.length];
}

function matches(clause, tags, descriptions = []) {
    if (clause.compound) {
        const { filter = [], must = [], should = [], minimumShouldMatch = 0 } = clause.compound;
        return [...filter, ...must].every(child => matches(child, tags, descriptions)) && should.filter(child => matches(child, tags, descriptions)).length >= minimumShouldMatch;
    }
    const { query, fuzzy, path } = clause.text;
    const paths = [path].flat();
    const values = [...(paths.includes('tags') ? tags : []), ...(paths.includes('searchDescriptions') ? descriptions : [])];
    return tokens(query).every(word => values.flatMap(tokens).some(tag => word === tag || fuzzy && distance(word, tag) <= fuzzy.maxEdits));
}

function harness(records, mappings = [], dictionaryRows = []) {
    const traces = [], modules = new Map();
    let unavailable = false;
    const tagMap = { find(filter) {
        const result = mappings.filter(row => filter.$or ? filter.$or.some(branch => new RegExp(branch.original.$regex).test(row.original))
            : Object.entries(filter).every(([key, value]) => value.$in.includes(row[key])));
        return { sort() { return this; }, limit() { return this; }, lean: async () => result };
    } };
    const wallpaper = { aggregate(pipeline) { traces.push(pipeline); return { option: async options => {
        assert.ok([1500, 3000].includes(options.maxTimeMS));
        if (unavailable) throw new Error('offline fixture');
        const base = pipeline.find(stage => stage.$match?.status).$match;
        const search = pipeline.find(stage => stage.$search)?.$search;
        const counts = new Map();
        const filtered = records.filter(record => record.status === base.status && (!base.type || record.type === base.type) &&
            record.artistActive !== false && (!search || matches(search, record.tags, record.searchDescriptions)));
        if (!pipeline.some(stage => stage.$group)) { return filtered.slice(0, 1); }
        for (const record of filtered) {
            for (const tag of record.tags) { counts.set(tag, (counts.get(tag) || 0) + 1); }
        }
        return [...counts].map(([_id, count]) => ({ _id, count }));
    } }; } };
    const database = { connection: { readyState: 1, collection: name => ({
        distinct: async () => [...new Set(dictionaryRows.flatMap(row => row.terms))],
        aggregate: () => ({ toArray: async () => [...new Set(records.filter(row => row.status === 'approved').flatMap(row => row.tags))]
            .map(_id => ({ _id, count: records.filter(row => row.status === 'approved' && row.tags.includes(_id)).length })) }),
        find: filter => ({
            project() { return this; }, sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; },
            toArray: async () => name === 'tagmaps' ? mappings : dictionaryRows.filter(row => row.terms.some(term => filter.terms.$in.includes(term))),
        }),
    }) } };
    function load(filename) {
        if (modules.has(filename)) return modules.get(filename);
        const local = createRequire(filename), module = { exports: {} };
        new Function('require', 'module', 'exports', readFileSync(filename, 'utf8'))(name => {
            if (name === '../models/Wallpaper') return wallpaper;
            if (name === '../models/TagMap') return tagMap;
            if (name === 'mongoose') return database;
            if (name === '../utils/tagResolver') return load(path.resolve(__dirname, '../utils/tagResolver.js'));
            return local(name);
        }, module, module.exports);
        modules.set(filename, module.exports); return module.exports;
    }
    const controller = load(path.resolve(__dirname, 'searchSuggestionsController.js'));
    return { traces, fail(value) { unavailable = value; }, async popular(type = 'all') {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
        await controller.popularSearchTags({ query: { type } }, res); return res;
    }, async search(q, type = 'all') {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
        await controller.searchSuggestions({ query: { q, type } }, res); return res;
    } };
}
const wall = (tags, type = 'image', status = 'approved', artistActive = true) => ({ tags, type, status, artistActive });

test('bilingual corrections handle a typo anywhere and preserve the full query and media filters', async () => {
    const h = harness([wall(['squirrel', 'blue']), wall(['squirrel', 'red'], 'video')], [], [{ terms: ['squirrel', 'ardilla'] }]);
    assert.ok((await h.search('adrillas azul', 'image')).data.some(item => item.query === 'ardilla azul' && item.kind === 'correction'));
    assert.ok((await h.search('adrillas asul', 'image')).data.some(item => item.query === 'ardilla azul' && item.kind === 'correction'));
    assert.deepEqual((await h.search('adrillas azul', 'video')).data, []);
    assert.ok((await h.search('rojo adrillas', 'video')).data.some(item => item.query === 'rojo ardilla'));
});

test('ambiguous dictionary corrections are selectable and each respects all concepts and artist approval', async () => {
    const h = harness([wall(['beaver', 'blue']), wall(['shepherd', 'blue']), wall(['shepherd', 'red'], 'image', 'pending')], [],
        [{ terms: ['beaver', 'castor'] }, { terms: ['shepherd', 'pastor'] }]);
    const result = await h.search('bastor azul');
    assert.deepEqual(new Set(result.data.map(item => item.query)), new Set(['castor azul', 'pastor azul']));
    assert.ok(result.data.every(item => item.kind === 'correction'));
    assert.deepEqual(new Set((await h.search('bastor asul')).data.map(item => item.query)), new Set(['castor azul', 'pastor azul']));
    assert.deepEqual((await h.search('bastor rojo')).data, []);
});

test('suggestions recognize visual equivalents in both prefixes and query context', async () => {
    const h = harness([wall(['girl', 'blue']), wall(['car', 'orange'])]);
    assert.ok((await h.search('muj')).data.some(item => item.query === 'mujer'));
    assert.deepEqual((await h.search('mujer az')).data, [{ label: 'mujer azul', query: 'mujer azul', kind: 'completion' }]);
    assert.ok((await h.search('automó')).data.some(item => item.query === 'automovil'));
    const reverse = harness([wall(['woman', 'blue'])]);
    assert.ok((await reverse.search('chi')).data.some(item => item.query === 'chica'));
});

test('Spanish completions preserve the full query and are supported by the selected media type', async () => {
    const h = harness([wall(['naruto', 'blue']), wall(['naruto', 'red'], 'video'), wall(['boruto', 'blue'], 'video')]);
    assert.deepEqual((await h.search('Naruto az', 'image')).data, [{ label: 'Naruto azul', query: 'Naruto azul', kind: 'completion' }]);
    assert.deepEqual((await h.search('Naruto az', 'video')).data, []);
    assert.ok((await h.search('naruto ro', 'video')).data.some(item => item.query === 'naruto rojo'));
});

test('description context supports suggestions without turning prose into suggestions', async () => {
    const h = harness([{ ...wall(['blue']), searchDescriptions: ['A girl stands in the rain on a city street.'] }]);
    assert.deepEqual((await h.search('chica lluvia az')).data,
        [{ label: 'chica lluvia azul', query: 'chica lluvia azul', kind: 'completion' }]);
    assert.deepEqual((await h.search('city')).data, []);
});

test('phrase aliases retain accented display labels while finding canonical catalogue tags', async () => {
    const h = harness([wall(['spiderman', 'blue']), wall(['mountain'])]);
    assert.deepEqual((await h.search('hombre ara')).data, [{ label: 'hombre araña', query: 'hombre araña', kind: 'completion' }]);
    assert.ok((await h.search('hombre araña az')).data.some(item => item.query === 'hombre araña azul'));
    assert.ok((await h.search('monta')).data.some(item => item.label === 'montaña'));
});

test('learned aliases only suggest concepts which exist, and metadata collisions remain protected', async () => {
    const h = harness([wall(['space hero']), wall(['ice'])], [{ original: 'heroe espacial', canonical: 'space hero' }, { original: 'nieve', canonical: 'ice' }]);
    assert.ok((await h.search('heroe esp')).data.some(item => item.query === 'heroe espacial'));
    assert.deepEqual((await h.search('niev')).data, []);
});

test('a one-edit correction preserves other requested concepts and never inserts an unrelated color', async () => {
    const h = harness([wall(['naruto', 'blue']), wall(['boruto', 'red'])]);
    assert.deepEqual((await h.search('azul narutoo')).data, [{ label: 'azul naruto', query: 'azul naruto', kind: 'correction' }]);
    assert.deepEqual((await h.search('rojo narutoo')).data, []);
});

test('pending content and inactive artists are excluded and repeated prefixes reuse the vocabulary', async () => {
    const h = harness([wall(['naruto', 'blue']), wall(['naruto', 'red'], 'image', 'pending'), wall(['naruto', 'green'], 'image', 'approved', false)]);
    await h.search('naruto az'); const calls = h.traces.length;
    await h.search('naruto azu'); assert.equal(h.traces.length, calls);
    assert.deepEqual((await h.search('naruto roj')).data, []);
    assert.deepEqual((await h.search('naruto verd')).data, []);
});

test('invalid input is rejected; failures are retryable; suggestions stay short and deterministic', async () => {
    const h = harness(Array.from({ length: 15 }, (_, i) => wall([`series ${i}`])));
    for (const [q, type] of [['a'.repeat(151), 'all'], ['x\n', 'all'], [[], 'all'], ['x', 'other']]) {
        assert.equal((await h.search(q, type)).code, 400);
    }
    assert.equal(h.traces.length, 0);
    assert.deepEqual((await h.search('a')).data, []);
    h.fail(true); assert.equal((await h.search('series')).code, 503);
    h.fail(false); const result = await h.search('series');
    assert.equal(result.code, 200); assert.equal(result.data.length, 8);
    assert.deepEqual((await h.search('series')).data, result.data);
});

test('empty-state recommendations only use available approved content of the chosen type', async () => {
    const h = harness([wall(['car'], 'video'), wall(['flower']), wall(['naruto'], 'video', 'pending')]);
    assert.deepEqual((await h.popular('video')).data, ['car']);
    assert.deepEqual((await h.popular('image')).data, ['flower']);
    assert.equal((await h.popular('other')).code, 400);
});
