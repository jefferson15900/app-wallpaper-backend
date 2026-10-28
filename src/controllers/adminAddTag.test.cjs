// Run: node --test src/controllers/adminAddTag.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const { addMetadataTag, removeMetadataTag, effectiveMetadata, searchTagsFor } = require('../utils/wallpaperMetadata');

const carousel = () => ({ _id: 'a'.repeat(24), status: 'approved', metadataVersion: 1, metadataRevision: 0,
    tags: ['legacy', 'anime', 'blue', 'red'], manualTags: ['legacy'], metadata: { styles: ['anime'], descriptionEs: 'Original' },
    images: [
        { assetId: 'one', imageUrl: 'one.jpg', aiMetadata: { colors: ['blue'] }, metadata: { characters: ['goku'] } },
        { assetId: 'two', imageUrl: 'two.jpg', metadata: { colors: ['red'], styles: [] } },
    ],
});

test('image TAGs keep effective values, preserve other images and become searchable', () => {
    const current = carousel();
    const changes = addMetadataTag(current, { tagToAdd: ' #Morado ', field: 'colors', assetId: 'one' });
    assert.deepEqual(changes.images[0].metadata.colors, ['blue', 'purple']);
    assert.deepEqual(changes.images[0].metadata.characters, ['goku']);
    assert.deepEqual(changes.images[1], current.images[1]);
    assert.deepEqual(current.images[0].aiMetadata.colors, ['blue']);
    assert.equal(changes.metadata, undefined);
    assert.ok(searchTagsFor({ ...current, ...changes }).includes('purple'));
});

test('publication TAGs reach images with overrides without replacing their data', () => {
    const current = carousel();
    const changes = addMetadataTag(current, { tagToAdd: 'Pixelart', field: 'styles' });
    assert.deepEqual(changes.metadata.styles, ['anime', 'pixel art']);
    assert.equal(changes.metadata.descriptionEs, 'Original');
    assert.deepEqual(effectiveMetadata(changes.images[0], changes.metadata).styles, ['anime', 'pixel art']);
    assert.deepEqual(effectiveMetadata(changes.images[1], changes.metadata).styles, ['pixel art']);
    assert.deepEqual(changes.images[1].metadata.colors, ['red']);
    // A TAG in the flat search array may still need a category or a different image.
    assert.deepEqual(addMetadataTag(current, { tagToAdd: 'blue', field: 'colors', assetId: 'two' }).images[1].metadata.colors, ['red', 'blue']);
});

test('duplicates, invalid destinations, limits and non-tag fields are rejected', () => {
    const invalid = [
        { tagToAdd: 'azul', field: 'colors', assetId: 'one' },
        { tagToAdd: 'x', field: 'description' }, { tagToAdd: 'x', field: 'colors', assetId: 'foreign' },
        { tagToAdd: 'x', field: 'colors', assetId: null }, { tagToAdd: '#', field: 'colors' },
        { tagToAdd: 'x,y', field: 'colors' }, { tagToAdd: 'x\ny', field: 'colors' },
        { tagToAdd: 'x'.repeat(81), field: 'colors' }, { tagToAdd: { $ne: '' }, field: 'colors' },
    ];
    for (const request of invalid) assert.throws(() => addMetadataTag(carousel(), request), error => error.statusCode === 400);
    const full = { metadata: { colors: Array.from({ length: 8 }, (_, i) => `color-${i}`) } };
    assert.throws(() => addMetadataTag(full, { tagToAdd: 'blue', field: 'colors' }), error => error.statusCode === 400);
    assert.deepEqual(addMetadataTag({ tags: ['old'] }, { tagToAdd: 'Pokémon', field: 'franchises' }).metadata, { franchises: ['pokemon'] });
});

function harness(record = carousel(), action = 'adminAddTag') {
    let writes = 0, count = 0, invalidated = false, role = 'admin';
    const Wallpaper = {
        findById: () => ({ lean: async () => record }),
        findOneAndUpdate: async (filter, update) => {
            writes++;
            assert.equal(filter.metadataRevision, record.metadataRevision);
            record = { ...record, ...update.$set, metadataRevision: record.metadataRevision + 1 };
            return record;
        },
    };
    const evaluate = (file, dependencies) => {
        const filePath = path.join(__dirname, file), module = { exports: {} }, localRequire = createRequire(filePath);
        vm.runInNewContext(readFileSync(filePath, 'utf8'), { module, exports: module.exports, console,
            require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name) });
        return module.exports;
    };
    const service = evaluate('../services/wallpaperMetadataService.js', { '../models/Wallpaper': Wallpaper });
    const controller = evaluate('wallpaperController.js', {
        '../models/Wallpaper': Wallpaper, '../models/User': { findById: async () => ({ role }) },
        '../services/wallpaperMetadataService': service,
        '../config/cloudinary': {}, '../services/aiQueue': {},
        '../models/TagSuggestion': { bulkWrite: async ops => { count += ops.reduce((sum, op) => sum + op.updateOne.update.$inc.count, 0); } },
        '../models/RelatedCache': { deleteOne: async () => { invalidated = true; } },
    });
    return { record: () => record, writes: () => writes, count: () => count, invalidated: () => invalidated,
        role: value => { role = value; },
        async submit(body) {
            let status = 200, data;
            const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; } };
            await controller[action]({ params: { id: 'a'.repeat(24) }, user: { id: 'admin' }, body }, res);
            return { status, data };
        },
    };
}

test('admin endpoint stores categories, updates the search projection and returns fresh image data', async () => {
    const h = harness();
    let response = await h.submit({ tagToAdd: 'Morado', field: 'colors', assetId: 'one' });
    assert.equal(response.status, 200);
    assert.ok(response.data.tags.includes('purple'));
    assert.deepEqual(response.data.images[0].metadata.colors, ['blue', 'purple']);
    assert.deepEqual(response.data.manualTags, ['legacy']);
    assert.equal(h.record().metadataRevision, 1);
    assert.equal(h.count(), 2); // purple plus goku, absent from the fixture's old projection.
    assert.equal(h.invalidated(), true);
    response = await h.submit({ tagToAdd: 'purple', field: 'colors', assetId: 'one' });
    assert.equal(response.status, 400); assert.equal(h.writes(), 1);
    assert.equal((await h.submit({ tagToAdd: 'x', field: 'colors', assetId: 'foreign' })).status, 400);
    h.role('user');
    assert.equal((await h.submit({ tagToAdd: 'x', field: 'colors' })).status, 403);
    assert.equal(h.writes(), 1);
});

test('legacy records retain their old tags and pending content does not raise public counts', async () => {
    const h = harness({ _id: 'a'.repeat(24), metadataRevision: 0, tags: ['legacy'], status: 'pending' });
    const response = await h.submit({ tagToAdd: 'Azul', field: 'colors' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.tags, ['legacy', 'blue']);
    assert.deepEqual(response.data.manualTags, ['legacy']);
    assert.equal(response.data.metadataVersion, 1);
    assert.equal(h.count(), 0);
});

test('removing an inherited image TAG creates an override without altering the other images or fields', () => {
    const original = carousel(); original.metadata.styles = ['anime', 'blue'];
    const changes = removeMetadataTag(original, 'ANIME', { field: 'styles', assetId: 'one' });
    assert.deepEqual(changes.images[0].metadata.styles, ['blue']);
    assert.deepEqual(changes.images[1], original.images[1]);
    assert.equal(changes.metadata, undefined);
    assert.deepEqual(original.metadata.styles, ['anime', 'blue']);
    assert.equal(effectiveMetadata(changes.images[0], original.metadata).descriptionEs, 'Original');
});

test('publication removal affects only the requested field and does not mask unrelated AI fields', () => {
    const original = carousel(); original.metadata.extraTags = ['blue'];
    const changes = removeMetadataTag(original, 'azul', { field: 'colors' });
    assert.deepEqual(changes.images[0].metadata.colors, []);
    assert.deepEqual(changes.images[0].aiMetadata.colors, ['blue']);
    assert.deepEqual(changes.images[1], original.images[1]);
    assert.equal(changes.metadata, undefined);
    assert.ok(searchTagsFor({ ...original, ...changes }).includes('blue')); // Remains in extraTags.
    const shared = removeMetadataTag(original, 'anime', { field: 'styles' });
    assert.deepEqual(shared.metadata.styles, []);
    assert.deepEqual(shared.images[0].metadata.styles, []);
    assert.equal(shared.metadata.descriptionEs, 'Original');
});

test('free TAG removal preserves classification and handles legacy long tags', () => {
    const original = carousel(); original.manualTags = ['anime', 'legacy'];
    const changes = removeMetadataTag(original, 'anime', { field: 'manualTags' });
    assert.deepEqual(changes, { manualTags: ['legacy'] });
    assert.ok(searchTagsFor({ ...original, ...changes }).includes('anime'));
    const long = 'paisaje '.repeat(30).trim();
    assert.deepEqual(removeMetadataTag({ tags: [long] }, long, { field: 'manualTags' }), { manualTags: [] });
    for (const target of [{ field: 'description' }, { field: 'colors', assetId: 'foreign' }, { field: 'manualTags', assetId: 'one' }]) {
        assert.throws(() => removeMetadataTag(original, 'blue', target), error => error.statusCode === 400);
    }
    assert.throws(() => removeMetadataTag(original, 'absent', { field: 'colors' }), error => error.statusCode === 409);
});

test('scoped endpoint decrements public counts only when the TAG disappears from the entire search projection', async () => {
    const original = carousel(); original.manualTags.push('blue');
    const h = harness(original, 'adminRemoveTag');
    let result = await h.submit({ tagToRemove: 'blue', field: 'colors', assetId: 'one' });
    assert.equal(result.status, 200); assert.ok(result.data.tags.includes('blue'));
    assert.equal(h.count(), 0); assert.equal(h.invalidated(), true);
    assert.deepEqual(result.data.images[0].metadata.colors, []);
    assert.deepEqual(result.data.images[1].metadata.colors, ['red']);
    result = await h.submit({ tagToRemove: 'azul', field: 'manualTags' });
    assert.equal(result.status, 200); assert.equal(result.data.tags.includes('blue'), false);
    assert.equal(h.count(), -1);
    assert.equal((await h.submit({ tagToRemove: 'blue', field: 'colors', assetId: 'one' })).status, 409);
    assert.equal(h.writes(), 2);
    h.role('user'); assert.equal((await h.submit({ tagToRemove: 'red', field: 'colors' })).status, 403);
    assert.equal(h.writes(), 2);
});

test('brief descriptions save on legacy images without changing TAGs or requiring a TAG', async () => {
    const h = harness({ _id: 'a'.repeat(24), metadataRevision: 0, tags: ['old'], status: 'approved', imageUrl: 'old.jpg' });
    const result = await h.submit({ field: 'descriptionEs', description: 'Una ciudad azul,\n  bajo la lluvia.' });
    assert.equal(result.status, 200);
    assert.equal(result.data.metadata.descriptionEs, 'Una ciudad azul, bajo la lluvia.');
    assert.deepEqual(result.data.tags, ['old']); assert.deepEqual(result.data.manualTags, ['old']);
    assert.deepEqual(h.record().searchDescriptions, ['Una ciudad azul, bajo la lluvia.']);
    assert.equal(h.count(), 0); assert.equal(h.invalidated(), true);
});

test('brief descriptions update only the target image and publication scope updates all Spanish descriptions', async () => {
    const original = carousel(); original.images[0].metadata.descriptionEn = 'Old English description';
    original.images[0].metadata.descriptionEnSource = 'Original';
    const h = harness(original);
    let result = await h.submit({ field: 'descriptionEs', description: 'Nueva descripción para Goku.', assetId: 'one' });
    assert.equal(result.status, 200);
    assert.equal(result.data.images[0].metadata.descriptionEs, 'Nueva descripción para Goku.');
    assert.equal(result.data.images[0].metadata.descriptionEn, 'Old English description');
    assert.equal(result.data.images[0].metadata.descriptionEnSource, 'Original');
    assert.deepEqual(result.data.images[1], original.images[1]);
    assert.deepEqual(result.data.metadata, original.metadata);
    assert.deepEqual(result.data.images[0].metadata.characters, ['goku']);
    result = await h.submit({ field: 'descriptionEs', description: 'Una descripción compartida.' });
    assert.equal(result.status, 200);
    assert.equal(result.data.metadata.descriptionEs, 'Una descripción compartida.');
    assert.ok(result.data.images.every(image => image.metadata.descriptionEs === 'Una descripción compartida.'));
    assert.equal(h.count(), 0);
});

test('description writes reject blank, oversized, invalid and foreign targets before persisting', async () => {
    const h = harness();
    for (const body of [
        { field: 'descriptionEs', description: '' }, { field: 'descriptionEs', description: '  ' },
        { field: 'descriptionEs', description: 'x'.repeat(241) }, { field: 'descriptionEs', description: { $ne: '' } },
        { field: 'descriptionEs', description: 'Texto', assetId: 'foreign' },
        { field: 'descriptionEs', description: 'Texto', assetId: null },
        { field: 'descriptionEs', description: 'Texto', tagToAdd: 'blue' },
    ]) assert.equal((await h.submit(body)).status, 400, JSON.stringify(body));
    assert.equal(h.writes(), 0);
    h.role('user'); assert.equal((await h.submit({ field: 'descriptionEs', description: 'Texto' })).status, 403);
    assert.equal(h.writes(), 0);
    h.role('admin'); assert.equal((await h.submit({ field: 'descriptionEs', description: 'x'.repeat(240) })).status, 200);
});

test('description translation stores both languages and source only on the selected image', async () => {
    const original = carousel(); const h = harness(original);
    const request = { field: 'descriptionEs', assetId: 'one', description: 'Color rojo', descriptionEn: 'Red color', descriptionEnSource: 'Color rojo' };
    const result = await h.submit(request);
    assert.equal(result.status, 200);
    assert.equal(result.data.images[0].metadata.descriptionEn, 'Red color');
    assert.equal(result.data.images[0].metadata.descriptionEnSource, 'Color rojo');
    assert.deepEqual(result.data.images[1], original.images[1]);
    assert.ok(h.record().searchDescriptions.includes('Color rojo'));
    assert.ok(h.record().searchDescriptions.includes('Red color'));
    assert.equal(result.data.tags.includes('Red color'), false); assert.equal(h.count(), 0);
});

test('English description validation rejects stale, missing and oversized sources without saving', async () => {
    const h = harness();
    for (const extra of [
        { descriptionEn: 'Red color' }, { descriptionEn: 'Red color', descriptionEnSource: 'Color azul' },
        { descriptionEn: 'x'.repeat(241), descriptionEnSource: 'Color rojo' },
        { descriptionEn: { $ne: '' }, descriptionEnSource: 'Color rojo' },
    ]) assert.equal((await h.submit({ field: 'descriptionEs', description: 'Color rojo', ...extra })).status, 400);
    assert.equal(h.writes(), 0);
    const result = await h.submit({ field: 'descriptionEs', description: 'Color rojo', descriptionEn: 'Red color', descriptionEnSource: 'Color rojo' });
    assert.equal(result.status, 200);
    assert.ok(result.data.images.every(image => image.metadata.descriptionEn === 'Red color'));
});

test('English originals and Spanish translations save by image or publication without crossing fields', async () => {
    const original = carousel(); const h = harness(original);
    let result = await h.submit({ field: 'descriptionEn', assetId: 'one', description: 'A red city.' });
    assert.equal(result.status, 200);
    assert.equal(result.data.images[0].metadata.descriptionEn, 'A red city.');
    assert.deepEqual(result.data.images[1], original.images[1]);
    result = await h.submit({ field: 'descriptionEn', assetId: 'one', description: 'A red city.',
        descriptionEs: 'Una ciudad roja.', descriptionEsSource: 'A red city.' });
    assert.equal(result.status, 200);
    assert.equal(result.data.images[0].metadata.descriptionEs, 'Una ciudad roja.');
    assert.equal(result.data.images[0].metadata.descriptionEsSource, 'A red city.');
    assert.ok(!h.record().searchDescriptions.includes('A prior source.'));
    assert.deepEqual(result.data.images[1], original.images[1]);
    result = await h.submit({ field: 'descriptionEn', description: 'A blue city.',
        descriptionEs: 'Una ciudad azul.', descriptionEsSource: 'A blue city.' });
    assert.equal(result.status, 200);
    assert.ok(result.data.images.every(image => image.metadata.descriptionEn === 'A blue city.'
        && image.metadata.descriptionEs === 'Una ciudad azul.' && image.metadata.descriptionEsSource === 'A blue city.'));
    assert.equal(h.count(), 0);
});

test('Spanish translations from English reject invalid or stale provenance and retain old text on failure', async () => {
    const h = harness();
    for (const extra of [
        { descriptionEs: 'Una ciudad roja.' }, { descriptionEs: 'Una ciudad roja.', descriptionEsSource: 'A blue city.' },
        { descriptionEs: 'x'.repeat(241), descriptionEsSource: 'A red city.' },
        { descriptionEs: 'Una ciudad roja.', descriptionEsSource: [] },
    ]) assert.equal((await h.submit({ field: 'descriptionEn', description: 'A red city.', ...extra })).status, 400);
    assert.equal(h.writes(), 0);
});
