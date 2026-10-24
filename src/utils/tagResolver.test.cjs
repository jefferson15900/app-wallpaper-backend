const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { cleanTags } = require('../config/tags');
const { normalizeMetadata } = require('./wallpaperMetadata');
const TagMap = require('../models/TagMap');

function resolver(rows = [], unavailable = false, dictionaryRows = [], catalogue = []) {
    let elapsed = 0;
    const Clock = class extends Date { static now() { return Date.now() + elapsed; } };
    const queries = [];
    const model = { find: filter => ({ lean: async () => {
        queries.push(filter);
        if (unavailable) { throw new Error('offline test'); }
        const [field, condition] = Object.entries(filter)[0];
        return rows.filter(row => condition.$in.includes(row[field]));
    } }) };
    const module = { exports: {} };
    const database = { connection: { readyState: 1, collection: name => ({
        distinct: async () => { if (unavailable) { throw new Error('offline'); } return [...new Set(dictionaryRows.flatMap(row => row.terms))]; },
        aggregate: () => ({ toArray: async () => catalogue.map(_id => ({ _id, count: 1 })) }),
        find: filter => ({
        project() { return this; }, sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; },
        async toArray() {
            if (unavailable) { throw new Error('offline dictionary test'); }
            return name === 'tagmaps' ? rows : dictionaryRows.filter(row => row.terms.some(term => filter.terms.$in.includes(term)));
        },
    }) }) } };
    vm.runInThisContext(`(function(require,module,exports,Date){${readFileSync(`${__dirname}/tagResolver.js`, 'utf8')}\n})`)(
        name => name === '../models/TagMap' ? model : name === 'mongoose' ? database : require(name), module, module.exports, Clock);
    return { ...module.exports, queries, advance(ms) { elapsed += ms; } };
}

test('manual tags and structured metadata agree on canonical subjects, styles and environments', async () => {
    const r = resolver();
    const metadata = normalizeMetadata({ subjects: ['flores', 'planeta'], styles: ['ciencia ficcion', 'minimalismo'], environments: ['nieve', 'calle'] });
    const expected = Object.values(metadata).flat();
    assert.deepEqual(await r.resolveTagsArray(cleanTags(['flores', 'planeta', 'ciencia ficción', 'minimalismo', 'nieve', 'calle'])), expected);
    assert.equal(r.queries.length, 0);
});

test('spelling corrects Spanish transpositions and plurals before bilingual lookup, preserving colors', async () => {
    const r = resolver([], false, [{ terms: ['squirrel', 'ardilla'] }], ['squirrel', 'blue']);
    for (const query of ['adrilla azul', 'adrillas azules', 'ardila azul', 'ardillla azul', 'adrillas asul']) {
        const [animal, color] = await r.resolveSearchConcepts(query);
        assert.ok(animal.alternatives.includes('squirrel'), query);
        assert.equal(animal.correction, 'ardilla');
        assert.equal(color.canonical, 'blue');
    }
    assert.deepEqual(await r.resolveTagsArray(['adrillas']), ['adrillas']);
    const phrases = resolver([], false, [{ terms: ['squirrel', 'ardilla'] }], ['squirrel on a tree']);
    assert.ok((await phrases.resolveSearchConcepts('adrillas'))[0].alternatives.includes('squirrel'));
});

test('spelling preserves exact catalogue names, valid dictionary words and uncertain alternatives', async () => {
    const rows = [{ terms: ['beaver', 'castor'] }, { terms: ['shepherd', 'pastor'] }, { terms: ['validword'] }];
    const r = resolver([], false, rows, ['beaver', 'shepherd', 'baruto', 'naruto']);
    for (const query of ['baruto', 'validword', 'bastor']) {
        const [concept] = await r.resolveSearchConcepts(query);
        assert.equal(concept.original, query);
        assert.equal(concept.correction, undefined, query);
    }
    assert.deepEqual(new Set(await r.suggestSearchCorrections('un bastor azul')), new Set(['un castor azul', 'un pastor azul']));
    assert.deepEqual(await r.suggestSearchCorrections('baruto'), []);
});

test('spelling requires catalogue support and frozen choices survive changing vocabulary', async () => {
    const r = resolver([], false, [{ terms: ['squirrel', 'ardilla'] }], []);
    assert.equal((await r.resolveSearchConcepts('adrillas'))[0].correction, undefined);
    const [pinned] = await r.resolveSearchConcepts('adrillas azul', new Set(), {
        corrections: [{ original: 'adrillas', term: 'ardilla' }],
    });
    assert.ok(pinned.alternatives.includes('squirrel'));
    assert.equal((await r.resolveSearchConcepts('adrillas', new Set(), { corrections: [] }))[0].correction, undefined);
    const [invalid] = await r.resolveSearchConcepts('adrillas', new Set(), { corrections: [{ original: 'adrillas', term: 'naruto' }] });
    assert.equal(invalid.correction, undefined);
});

test('catalogue refresh automatically protects newly published names without changing saved tags', async () => {
    const catalogue = ['beaver'];
    const r = resolver([], false, [{ terms: ['beaver', 'castor'] }], catalogue);
    assert.equal((await r.resolveSearchConcepts('bastor'))[0].correction, 'castor');
    catalogue.push('bastor');
    r.advance(61000);
    const [name] = await r.resolveSearchConcepts('bastor');
    assert.equal(name.correction, undefined);
    assert.equal(name.canonical, 'bastor');
});

test('database dictionary resolves unseen words, plurals and phrases without translating saved tags', async () => {
    const r = resolver([], false, [
        { terms: ['squirrel', 'ardilla'] }, { terms: ['moonlight', 'claro de luna', 'lunada'] },
    ]);
    const [animal, color] = await r.resolveSearchConcepts('ardillas azules');
    assert.ok(animal.alternatives.includes('squirrel'));
    assert.equal(color.canonical, 'blue');
    const [phrase] = await r.resolveSearchConcepts('claro de luna');
    assert.ok(phrase.alternatives.includes('moonlight'));
    assert.ok(phrase.alternatives.includes('moon'));
    assert.equal(phrase.original, 'claro de luna');
    assert.ok((await r.resolveSearchConcepts('squirrel'))[0].alternatives.includes('ardilla'));
    assert.deepEqual(await r.resolveTagsArray(['squirrel']), ['squirrel']);
});

test('general dictionary respects curated meanings and never traverses unrelated senses', async () => {
    const r = resolver([{ original: 'custom alias', canonical: 'custom subject' }], false, [
        { terms: ['red', 'red de pesca'] }, { terms: ['custom alias', 'wrong meaning'] },
        { terms: ['bank', 'ribera', 'orilla'] }, { terms: ['bank', 'banco', 'banca'] },
    ]);
    assert.ok(!(await r.resolveSearchConcepts('rojo'))[0].alternatives.includes('red de pesca'));
    assert.ok(!(await r.resolveSearchConcepts('custom alias'))[0].alternatives.includes('wrong meaning'));
    const [shore] = await r.resolveSearchConcepts('ribera');
    assert.ok(shore.alternatives.includes('bank'));
    assert.ok(!shore.alternatives.includes('banco'));
});

test('learned translations normalize their canonical value and cannot override metadata vocabulary', async () => {
    const r = resolver([{ original: 'azulado', canonical: 'AZUL' }, { original: 'nieve', canonical: 'ice' }]);
    assert.deepEqual(await r.resolveTagsArray([' Azulado ', 'AZUL', 'nieve']), ['blue', 'snow']);
    assert.equal(await r.resolveToCanonical(''), '');
});

test('phrase queries batch dictionary reads and preserve known plurals without truncating names', async () => {
    const r = resolver();
    const concepts = await r.resolveSearchConcepts('gatos azules cosmos lunes', new Set(), { spelling: false });
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

test('visual equivalents work both ways without changing saved subject labels', async () => {
    const r = resolver([{ original: 'dama', canonical: 'woman' }, { original: 'nieve', canonical: 'woman' }]);
    for (const query of ['mujer', 'chica', 'woman', 'girl', 'mujeres', 'muchachas', 'women', 'girls']) {
        const [concept] = await r.resolveSearchConcepts(query);
        for (const equivalent of ['woman', 'girl', 'mujer', 'chica', 'dama']) {
            assert.ok(concept.alternatives.includes(equivalent), `${query} must find ${equivalent}`);
        }
        assert.ok(!concept.alternatives.includes('man'));
        assert.ok(!concept.alternatives.includes('nieve'));
    }
    const [male] = await r.resolveSearchConcepts('hombres');
    for (const equivalent of ['man', 'boy', 'hombre', 'chico', 'men', 'boys']) {
        assert.ok(male.alternatives.includes(equivalent));
    }
    assert.ok(!male.alternatives.includes('woman'));
    assert.deepEqual(normalizeMetadata({ subjects: ['chica', 'mujer', 'chico', 'hombre'] }).subjects, ['girl', 'woman', 'boy', 'man']);
    assert.deepEqual(await r.resolveTagsArray(['chica', 'mujer', 'chico', 'hombre']), ['girl', 'woman', 'boy', 'man']);
});

test('expanded translations handle accents, plurals and phrases while preserving other concepts', async () => {
    const r = resolver();
    const cases = [
        ['automóviles', 'car'], ['anaranjadas', 'orange'], ['moradas', 'purple'], ['anteojos', 'glasses'],
        ['audífonos', 'headphone'], ['motocicletas', 'motorcycle'], ['delfines', 'dolphin'], ['pingüinos', 'penguin'],
        ['puesta de sol', 'sunset'], ['salida del sol', 'sunrise'], ['naves espaciales', 'spaceship'],
        ['arte pixelado', 'pixel art'], ['ciencia ficción', 'sci-fi'], ['brujas', 'witch'], ['árboles', 'tree'],
    ];
    for (const [query, canonical] of cases) {
        const concepts = await r.resolveSearchConcepts(query);
        assert.deepEqual(concepts.map(concept => concept.canonical), [canonical], query);
        assert.ok(concepts[0].alternatives.includes(canonical));
    }
    const [sunset, snow, witch, tree] = await r.resolveSearchConcepts('puesta de sol nieve bruja arbol');
    assert.ok(!sunset.alternatives.includes('sunrise'));
    assert.ok(!snow.alternatives.includes('ice'));
    assert.ok(!witch.alternatives.includes('wizard'));
    assert.ok(!tree.alternatives.includes('forest'));
    const [car] = await r.resolveSearchConcepts('car');
    assert.ok(car.alternatives.includes('automovil'));
    assert.ok(car.alternatives.includes('automoviles'));
});
