// Run: node --test src/utils/wallpaperMetadata.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeMetadata, parseMetadata, parseAssetMetadata, searchTagsFor, searchDescriptionsFor, matchedAssetId, removeMetadataTag } = require('./wallpaperMetadata');
const Wallpaper = require('../models/Wallpaper');

test('structured metadata normalizes explicit bilingual fields without guessing free tags', () => {
    assert.deepEqual(normalizeMetadata({ estilos: ['Pixel art', 'pixelart'], colores: ['Azul', 'BLUE'], ambientes: ['Lluvia', 'Noche'], personajes: ['Naruto Uzumaki'], extraTags: ['constructor'] }), {
        styles: ['pixel art'], colors: ['blue'], environments: ['rain', 'night'], characters: ['naruto uzumaki'], extraTags: ['constructor'],
    });
    assert.deepEqual(parseMetadata('{"subjects":[]}'), { subjects: [] });
    assert.deepEqual(searchTagsFor({ tags: ['legacy', 'unknown'] }), ['legacy', 'unknown']);
    assert.deepEqual(searchTagsFor({ metadata: { styles: ['constructor'] } }), ['constructor']);
    for (const input of [null, [], { colors: 'blue' }, { colors: [4] }, { colors: Array(9).fill('blue') }, { styles: ['x'.repeat(81)] }, { subjects: [{ $gt: '' }] }, { colors: ['a\nb'] }, { other: [] }]) {
        assert.throws(() => normalizeMetadata(input), error => error.statusCode === 400);
    }
    assert.throws(() => parseMetadata('{'), error => error.statusCode === 400);
    assert.throws(() => parseAssetMetadata('[{}]', 2), error => error.statusCode === 400);
});

test('manual values including an explicit empty list override AI; second image stays searchable', () => {
    const wallpaper = { manualTags: ['original'], tags: ['outdated'], metadata: { styles: ['anime'] }, images: [
        { assetId: 'one', metadata: { colors: [] }, aiMetadata: { colors: ['blue'], subjects: ['planet'] } },
        { assetId: 'two', metadata: { subjects: ['car'], colors: ['red'], environments: ['rain'] }, aiMetadata: { colors: ['blue'] } },
    ] };
    const tags = searchTagsFor(wallpaper);
    assert.ok(tags.includes('car') && tags.includes('rain'));
    assert.ok(!tags.includes('coche') && !tags.includes('lluvia'));
    assert.ok(!tags.includes('blue') && !tags.includes('outdated'));
    assert.equal(matchedAssetId(wallpaper, 'coche rojo'), 'two');
    assert.equal(matchedAssetId(wallpaper, 'planet red'), undefined);
    const changes = removeMetadataTag(wallpaper, 'rojo');
    assert.ok(!searchTagsFor({ ...wallpaper, ...changes }).includes('red'));
    assert.deepEqual(searchTagsFor({ metadata: { colors: ['blue'] }, images: [{ metadata: { colors: [] } }] }), []);
    assert.ok(!searchTagsFor({ metadata: { colors: ['blue'] }, images: [{ metadata: { colors: ['red'] } }] }).includes('blue'));
});

test('metadata projection stores only English canonical terms, without Spanish duplicates', () => {
    const metadata = normalizeMetadata({ subjects: ['ciudad'], environments: ['noche'], colors: ['azul'], extraTags: ['noche', 'ciudad'] });
    assert.deepEqual(searchTagsFor({ manualTags: ['city', 'ciudad'], metadata }), ['city', 'blue', 'night']);
    assert.deepEqual(searchTagsFor({ manualTags: ['ciudad'], ...removeMetadataTag({ manualTags: ['ciudad'] }, 'city') }), []);
});

test('brief descriptions validate independently from tags and accept an explicit manual clearing', () => {
    assert.deepEqual(normalizeMetadata({ descripción: '  A girl\nstands in the rain.  ' }), { description: 'A girl stands in the rain.' });
    assert.deepEqual(normalizeMetadata({ description: '' }), { description: '' });
    assert.equal(normalizeMetadata({ description: 'x'.repeat(240) }).description.length, 240);
    for (const input of [{ description: [] }, { description: 'x'.repeat(241) }, { description: 'a\u0000b' },
        { description: 'one', descripcion: 'two' }]) assert.throws(() => normalizeMetadata(input));
    const wallpaper = { metadata: { description: 'General scene.' }, images: [
        { assetId: 'one', aiMetadata: { description: 'A girl in the city.' }, metadata: { description: '' } },
        { assetId: 'two', metadata: { description: 'A girl stands in the rain, on a city street.' } },
    ] };
    assert.deepEqual(searchDescriptionsFor(wallpaper), ['A girl stands in the rain, on a city street.']);
    assert.deepEqual(searchTagsFor(wallpaper), []);
    assert.equal(matchedAssetId(wallpaper, 'girl rain city'), 'two');
    assert.equal(matchedAssetId(wallpaper, 'general'), undefined);
    assert.deepEqual(searchDescriptionsFor({ ...wallpaper, ...removeMetadataTag(wallpaper, 'girl') }), searchDescriptionsFor(wallpaper));
    assert.deepEqual(searchDescriptionsFor({ images: [{ aiMetadata: { description: 'AI scene.' } }] }), ['AI scene.']);
});

test('schema accepts structured assets and leaves legacy records without fabricated metadata', async () => {
    const legacy = new Wallpaper({ tags: ['anime'], imageUrl: 'x', public_id: 'p', artist: 'a'.repeat(24) }).toObject();
    assert.equal(legacy.metadata, undefined);
    assert.equal(legacy.metadataVersion, undefined);
    const record = new Wallpaper({ ...legacy, metadataVersion: 1, searchDescriptions: ['A blue scene.'], images: [{ assetId: 'asset', imageUrl: 'x', public_id: 'p', metadata: { colors: ['blue'], description: 'A blue scene.' }, analysis: { status: 'pending' } }] });
    await record.validate();
    assert.deepEqual(record.toObject().images[0].metadata.colors, ['blue']);
    assert.equal(record.toObject().images[0].metadata.description, 'A blue scene.');
    assert.deepEqual(record.toObject().searchDescriptions, ['A blue scene.']);
    record.images[0].analysis.status = 'invented';
    await assert.rejects(record.validate());
});

test('series and franchises are optional, separate from characters and searchable as English terms', async () => {
    const metadata = normalizeMetadata({ personajes: ['Meowth'], franquicias: ['Pokémon', 'pokemon'] });
    assert.deepEqual(metadata, { characters: ['meowth'], franchises: ['pokemon'] });
    assert.deepEqual(searchTagsFor({ manualTags: [], images: [{ assetId: 'asset', metadata }] }), ['meowth', 'pokemon']);
    assert.equal(matchedAssetId({ images: [{ assetId: 'asset', metadata }] }, 'pokemon'), 'asset');
    assert.deepEqual(normalizeMetadata({ series: ['One Piece'] }), { franchises: ['one piece'] });
    assert.throws(() => normalizeMetadata({ franchises: ['pokemon'], franquicias: ['pokemon'] }));
    assert.throws(() => normalizeMetadata({ franchises: Array(9).fill('pokemon') }));
    const record = new Wallpaper({ imageUrl: 'x', public_id: 'p', artist: 'a'.repeat(24), metadata,
        images: [{ imageUrl: 'x', metadata, aiMetadata: { franchises: ['pokemon'] } }],
    });
    await record.validate();
    assert.deepEqual(record.toObject().metadata.franchises, ['pokemon']);
    assert.deepEqual(record.toObject().images[0].metadata.franchises, ['pokemon']);
    assert.deepEqual(record.toObject().images[0].aiMetadata.franchises, ['pokemon']);
});

function load(relative, overrides) {
    const file = path.resolve(__dirname, relative);
    const localRequire = createRequire(file);
    const module = { exports: {} };
    const run = vm.runInThisContext(`(function(require, module, exports) { ${readFileSync(file, 'utf8')}\n})`, { filename: file });
    run(name => overrides[name] ?? localRequire(name), module, module.exports);
    return module.exports;
}

test('both descriptions and their source survive storage, editing, merging and tag removal without becoming tags', async () => {
    const metadata = normalizeMetadata({ descriptionEs: '  Un hombre de piel roja. ', descriptionEn: 'A man with red skin.', descriptionEnSource: 'Un hombre de piel roja.' });
    for (const field of ['descriptionEs', 'descriptionEn', 'descriptionEnSource', 'descriptionEsSource']) {
        assert.throws(() => normalizeMetadata({ [field]: 'x'.repeat(241) }));
        assert.throws(() => normalizeMetadata({ [field]: [] }));
    }
    const record = new Wallpaper({ imageUrl: 'x', public_id: 'p', artist: 'a'.repeat(24), metadata,
        images: [{ assetId: 'asset', imageUrl: 'x', metadata }] });
    await record.validate();
    assert.deepEqual(record.toObject().images[0].metadata, metadata);
    const wallpaper = record.toObject();
    assert.deepEqual(searchDescriptionsFor(wallpaper), [metadata.descriptionEs, metadata.descriptionEn]);
    assert.deepEqual(searchTagsFor(wallpaper), []);
    assert.equal(matchedAssetId(wallpaper, 'hombre piel roja'), 'asset');
    assert.equal(matchedAssetId(wallpaper, 'man red skin'), 'asset');
    assert.deepEqual(searchDescriptionsFor({ metadata: { descriptionEnSource: 'No es una descripción vigente.' } }), []);
    const reverse = { descriptionEn: 'A blue city.', descriptionEs: 'Una ciudad azul.', descriptionEsSource: 'A blue city.' };
    const reverseRecord = new Wallpaper({ imageUrl: 'x', public_id: 'p', artist: 'a'.repeat(24), images: [{ assetId: 'reverse', imageUrl: 'x', metadata: reverse }] });
    await reverseRecord.validate();
    assert.deepEqual(reverseRecord.toObject().images[0].metadata, reverse);
    assert.deepEqual(searchDescriptionsFor(reverseRecord.toObject()), ['Una ciudad azul.', 'A blue city.']);
    assert.deepEqual(searchDescriptionsFor({ metadata: { descriptionEsSource: 'An obsolete source.' } }), []);
    assert.deepEqual(removeMetadataTag(wallpaper, 'red').images[0].metadata, metadata);
    const { manualMetadataChanges, mergedMetadataChanges } = require('../services/wallpaperMetadataService');
    const edited = manualMetadataChanges(wallpaper, { assetMetadata: [{ assetId: 'asset', metadata: { ...metadata, descriptionEn: '' } }] });
    assert.deepEqual(searchDescriptionsFor({ ...wallpaper, ...edited }), [metadata.descriptionEs]);
    const merged = mergedMetadataChanges(wallpaper, { metadata: { descriptionEs: 'Otra escena.' }, imageUrl: 'other', tags: [] });
    assert.deepEqual(merged.searchDescriptions, [metadata.descriptionEs, metadata.descriptionEn, 'Otra escena.']);
});

test('translation makes one text-only request, validates output and never calls the image path', async () => {
    const savedKey = process.env.GOOGLE_AI_KEY;
    process.env.GOOGLE_AI_KEY = 'fake';
    let calls = 0, output = 'A man with red skin.', failure;
    const service = load('../services/aiService.js', { '@google/generative-ai': { GoogleGenerativeAI: function () {
        this.getGenerativeModel = config => {
            assert.equal(config.generationConfig.maxOutputTokens, 256);
            return { generateContent: async (parts, options) => {
                calls++;
                assert.ok(parts.every(part => typeof part === 'string'));
                assert.deepEqual(JSON.parse(parts[1]), { descriptionEs: 'Un hombre de piel roja.' });
                assert.equal(options.timeout, 25000);
                if (failure) throw failure;
                return { response: { text: () => JSON.stringify({ descriptionEn: output }) } };
            } };
        };
    } } });
    try {
        assert.deepEqual(await service.translateDescription(' Un hombre de piel roja. '),
            { descriptionEs: 'Un hombre de piel roja.', descriptionEn: 'A man with red skin.' });
        for (output of ['', 'x'.repeat(241), undefined]) await assert.rejects(service.translateDescription('Un hombre de piel roja.'));
        failure = Object.assign(new Error('quota'), { status: 429 });
        await assert.rejects(service.translateDescription('Un hombre de piel roja.'), error => error.status === 429);
        assert.equal(calls, 5);
        await assert.rejects(service.translateDescription('x'.repeat(241)));
        await assert.rejects(service.translateDescription(''));
        delete process.env.GOOGLE_AI_KEY;
        await assert.rejects(service.translateDescription('Un hombre de piel roja.'), error => error.statusCode === 503);
        assert.equal(calls, 5);
    } finally {
        if (savedKey === undefined) delete process.env.GOOGLE_AI_KEY; else process.env.GOOGLE_AI_KEY = savedKey;
    }
});

test('English-to-Spanish translation uses the correct prompt and fields with one text-only request', async () => {
    const savedKey = process.env.GOOGLE_AI_KEY;
    process.env.GOOGLE_AI_KEY = 'fake';
    let calls = 0, output = { descriptionEs: 'Una ciudad azul.' };
    const service = load('../services/aiService.js', { '@google/generative-ai': { GoogleGenerativeAI: function () {
        this.getGenerativeModel = () => ({ generateContent: async (parts, options) => {
            calls++;
            assert.ok(parts.every(part => typeof part === 'string'));
            assert.match(parts[0], /English wallpaper description into Spanish/);
            assert.deepEqual(JSON.parse(parts[1]), { descriptionEn: 'A blue city.' });
            assert.equal(options.timeout, 25000);
            return { response: { text: () => JSON.stringify(output) } };
        } });
    } } });
    try {
        assert.deepEqual(await service.translateDescription(' A blue city. ', 'en'), { descriptionEn: 'A blue city.', descriptionEs: 'Una ciudad azul.' });
        output = { descriptionEn: 'Wrong field' };
        await assert.rejects(service.translateDescription('A blue city.', 'en'));
        await assert.rejects(service.translateDescription('A blue city.', 'fr'), error => error.statusCode === 400);
        assert.equal(calls, 2);
    } finally {
        if (savedKey === undefined) delete process.env.GOOGLE_AI_KEY; else process.env.GOOGLE_AI_KEY = savedKey;
    }
});

test('metadata writes retry a concurrent change and preserve the newest manual values', async () => {
    let current = { _id: 'id', status: 'pending', metadataRevision: 0, manualTags: ['old'], images: [{ assetId: 'asset', metadata: { colors: ['red'], description: 'Manual scene.' } }] };
    let calls = 0;
    const model = {
        findById: () => ({ lean: async () => structuredClone(current) }),
        findOneAndUpdate: async (filter, update) => {
            calls++;
            if (calls === 1) { current.images[0].metadata.colors = ['green']; current.metadataRevision++; return null; }
            assert.equal(filter.metadataRevision, 1);
            current = { ...current, ...update.$set, metadataRevision: current.metadataRevision + 1 };
            return current;
        },
    };
    const service = load('../services/wallpaperMetadataService.js', { '../models/Wallpaper': model });
    const result = await service.updateMetadata('id', snapshot => ({ images: snapshot.images.map(image => ({ ...image, aiMetadata: { subjects: ['city'], colors: ['blue'], description: 'AI scene.' } })) }));
    assert.equal(calls, 2);
    assert.ok(result.tags.includes('green') && result.tags.includes('city') && !result.tags.includes('blue'));
    assert.deepEqual(result.searchDescriptions, ['Manual scene.']);
    const reviewed = service.manualMetadataChanges(result, { assetMetadata: [{ assetId: 'asset', metadata: { colors: [] } }] });
    assert.deepEqual(reviewed.images[0].metadata.colors, []);
    assert.throws(() => service.manualMetadataChanges(result, { assetMetadata: [{ assetId: 'foreign', metadata: {} }] }));
    current.status = 'approved';
    await assert.rejects(service.updateMetadata('id', () => ({}), true), error => error.statusCode === 409);
});

test('persistent worker claims one asset once and never automatically retries a paid failure', async () => {
    let current = { _id: 'id', manualTags: ['manual'], images: [{ assetId: 'a', imageUrl: 'cloudinary', metadata: { colors: ['red'] }, analysis: { status: 'pending' } }] };
    let calls = 0;
    const model = {
        updateMany: async () => ({}),
        findOneAndUpdate: (filter, update) => ({ lean: async () => {
            if (current.images[0].analysis.status !== 'pending') { return null; }
            current.images[0].analysis = { status: 'processing', runId: update.$set['images.$.analysis.runId'] };
            return structuredClone(current);
        } }),
    };
    const queue = load('../services/aiQueue.js', { '../models/Wallpaper': model,
        './aiService': { analyzeImage: async () => { calls++; throw new Error('API failed'); } },
        './wallpaperMetadataService': { updateMetadata: async (id, transform) => { Object.assign(current, transform(current)); } },
    });
    await queue.processNext();
    await queue.processNext();
    assert.equal(calls, 1);
    assert.equal(current.images[0].analysis.status, 'failed');
    assert.deepEqual(current.images[0].metadata, { colors: ['red'] });
});

test('metadata-only edits capture legacy tags once so old derived colors can be removed', async () => {
    let current = { _id: 'id', tags: ['original'], images: [] };
    const model = { findById: () => ({ lean: async () => structuredClone(current) }),
        findOneAndUpdate: async (filter, update) => { current = { ...current, ...update.$set, metadataRevision: (current.metadataRevision || 0) + 1 }; return current; },
    };
    const service = load('../services/wallpaperMetadataService.js', { '../models/Wallpaper': model });
    await service.updateMetadata('id', () => ({ metadata: { colors: ['blue'] } }));
    await service.updateMetadata('id', () => ({ metadata: { colors: ['red'] } }));
    assert.deepEqual(current.manualTags, ['original']);
    assert.ok(current.tags.includes('red') && !current.tags.includes('blue'));
});

test('merging materializes each source general metadata without leaking it to other images', () => {
    const { mergedMetadataChanges } = require('../services/wallpaperMetadataService');
    const primary = { metadata: { colors: ['blue'], description: 'Blue scene.' }, manualTags: ['one'], tags: ['blue'], images: [{ assetId: 'a', imageUrl: 'a' }], likes: ['u'], downloads: 2 };
    const secondary = { metadata: { colors: ['red'], description: 'Red scene.' }, manualTags: ['two'], tags: ['red'], images: [{ assetId: 'b', imageUrl: 'b' }], likes: ['u', 'v'], downloads: 3 };
    const changes = mergedMetadataChanges(primary, secondary);
    assert.equal(changes.metadata, undefined);
    assert.deepEqual(changes.images[0].metadata.colors, ['blue']);
    assert.deepEqual(changes.images[1].metadata.colors, ['red']);
    assert.deepEqual(changes.manualTags, ['one', 'two']);
    assert.deepEqual(changes.likes, ['u', 'v']);
    assert.equal(changes.downloads, 5);
    assert.deepEqual(changes.searchDescriptions, ['Blue scene.', 'Red scene.']);
    assert.equal(matchedAssetId({ ...primary, ...changes }, 'rojo'), 'b');
});

test('merge writes and deletion share one transaction and reject pending paid jobs', async () => {
    const session = { withTransaction: async callback => callback(), endSession: async () => {} };
    const records = { one: { _id: 'one', type: 'image', artist: 'artist', images: [{ imageUrl: 'one', assetId: 'a' }] },
        two: { _id: 'two', type: 'image', artist: 'artist', images: [{ imageUrl: 'two', assetId: 'b' }] } };
    const operations = [];
    const model = {
        findById: id => ({ session: selected => { assert.equal(selected, session); return { lean: async () => structuredClone(records[id]) }; } }),
        findByIdAndUpdate: async (id, update, options) => { assert.equal(options.session, session); operations.push('update'); assert.equal(update.$inc.metadataRevision, 1); return update.$set; },
        findByIdAndDelete: async (id, options) => { assert.equal(options.session, session); operations.push('delete'); },
    };
    const service = load('../services/wallpaperMetadataService.js', { mongoose: { startSession: async () => session }, '../models/Wallpaper': model,
        '../models/User': { findByIdAndUpdate: async (id, update, options) => { assert.equal(options.session, session); operations.push('counter'); } } });
    await service.mergeWithMetadata('one', 'two');
    assert.deepEqual(operations, ['update', 'delete', 'counter']);
    operations.length = 0;
    records.two.images[0].analysis = { status: 'pending' };
    await assert.rejects(service.mergeWithMetadata('one', 'two'), error => error.statusCode === 409);
    assert.deepEqual(operations, []);
});

test('image analysis uses one bounded request and cannot fall back to a more expensive model', async () => {
    const original = { fetch: global.fetch, key: process.env.GOOGLE_AI_KEY, model: process.env.WALLPAPER_AI_MODEL };
    let calls = 0, configuration, fail = false;
    process.env.GOOGLE_AI_KEY = 'fake-test-key'; delete process.env.WALLPAPER_AI_MODEL;
    global.fetch = async url => {
        assert.ok(url.pathname.includes('w_768,f_jpg'));
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => Uint8Array.from([255, 216, 255, 217]).buffer };
    };
    const service = load('../services/aiService.js', { '@google/generative-ai': { GoogleGenerativeAI: function () {
        this.getGenerativeModel = options => { configuration = options; return { generateContent: async () => {
            calls++; if (fail) throw new Error('model unavailable');
            return { response: { text: () => JSON.stringify({ subjects: ['city'], styles: [], colors: ['blue'], environments: ['rain'], characters: [], franchises: [], extraTags: [], description: 'A girl stands in the rain on a city street.' }) } };
        } }; };
    } } });
    try {
        const result = await service.analyzeImage('https://res.cloudinary.com/test/image/upload/v1/asset.jpg');
        assert.deepEqual(result.metadata.environments, ['rain']);
        assert.equal(result.metadata.description, 'A girl stands in the rain on a city street.');
        assert.equal(result.version, 2);
        assert.equal(calls, 1);
        assert.equal(configuration.model, 'gemini-2.5-flash');
        assert.equal(configuration.generationConfig.maxOutputTokens, 1024);
        fail = true;
        await assert.rejects(service.analyzeImage('https://res.cloudinary.com/test/image/upload/v1/asset.jpg'));
        assert.equal(calls, 2);
        await assert.rejects(service.analyzeImage('http://localhost/image.jpg'));
        assert.equal(calls, 2);
    } finally {
        global.fetch = original.fetch;
        if (original.key === undefined) delete process.env.GOOGLE_AI_KEY; else process.env.GOOGLE_AI_KEY = original.key;
        if (original.model === undefined) delete process.env.WALLPAPER_AI_MODEL; else process.env.WALLPAPER_AI_MODEL = original.model;
    }
});
