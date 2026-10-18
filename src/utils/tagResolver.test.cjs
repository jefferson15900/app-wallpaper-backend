const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { cleanTags } = require('../config/tags');
const { normalizeMetadata } = require('./wallpaperMetadata');
const TagMap = require('../models/TagMap');

function resolver(rows = [], unavailable = false) {
    const queries = [];
    const model = { find: filter => ({ lean: async () => {
        queries.push(filter);
        if (unavailable) { throw new Error('offline test'); }
        const [field, condition] = Object.entries(filter)[0];
        return rows.filter(row => condition.$in.includes(row[field]));
    } }) };
    const module = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${readFileSync(`${__dirname}/tagResolver.js`, 'utf8')}\n})`)(
        name => name === '../models/TagMap' ? model : require(name), module, module.exports);
    return { ...module.exports, queries };
}

test('manual tags and structured metadata agree on canonical subjects, styles and environments', async () => {
    const r = resolver();
    const metadata = normalizeMetadata({ subjects: ['flores', 'planeta'], styles: ['ciencia ficcion', 'minimalismo'], environments: ['nieve', 'calle'] });
    const expected = Object.values(metadata).flat();
    assert.deepEqual(await r.resolveTagsArray(cleanTags(['flores', 'planeta', 'ciencia ficción', 'minimalismo', 'nieve', 'calle'])), expected);
    assert.equal(r.queries.length, 0);
});

test('learned translations normalize their canonical value and cannot override metadata vocabulary', async () => {
    const r = resolver([{ original: 'azulado', canonical: 'AZUL' }, { original: 'nieve', canonical: 'ice' }]);
    assert.deepEqual(await r.resolveTagsArray([' Azulado ', 'AZUL', 'nieve']), ['blue', 'snow']);
    assert.equal(await r.resolveToCanonical(''), '');
});

test('phrase queries batch dictionary reads and preserve known plurals without truncating names', async () => {
    const r = resolver();
    const concepts = await r.resolveSearchConcepts('gatos azules cosmos lunes');
    assert.deepEqual(concepts.map(concept => concept.canonical), ['cat', 'blue', 'space', 'lunes']);
    assert.equal(r.queries.length, 2);
});

test('reverse learned aliases cannot smuggle a different metadata concept into the query', async () => {
    const r = resolver([{ original: 'nieve', canonical: 'ice' }, { original: 'escarchado', canonical: 'ice' }]);
    const [ice] = await r.resolveSearchConcepts('ice');
    assert.ok(ice.alternatives.includes('escarchado'));
    assert.ok(!ice.alternatives.includes('nieve'));
});

test('local translations and unknown terms stay usable when the learned dictionary fails', async () => {
    const r = resolver([], true);
    assert.deepEqual(await r.resolveTagsArray(['azul', 'unknown']), ['blue', 'unknown']);
    assert.deepEqual((await r.resolveSearchConcepts('hombre araña azul')).map(concept => concept.canonical), ['spiderman', 'blue']);
});

test('new learned aliases use the same accent and whitespace normalization as queries', async () => {
    const record = new TagMap({ original: '  HÉROE   ESPACIAL ', canonical: ' SPACE   HERO ' });
    await record.validate();
    assert.equal(record.original, 'heroe espacial');
    assert.equal(record.canonical, 'space hero');
});
