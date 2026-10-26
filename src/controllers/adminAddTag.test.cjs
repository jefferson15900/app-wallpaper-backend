// Run: node --test src/controllers/adminAddTag.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const { addMetadataTag, effectiveMetadata, searchTagsFor } = require('../utils/wallpaperMetadata');

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

function harness(record = carousel()) {
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
    const { adminAddTag } = evaluate('wallpaperController.js', {
        '../models/Wallpaper': Wallpaper, '../models/User': { findById: async () => ({ role }) },
        '../services/wallpaperMetadataService': service,
        '../config/cloudinary': {}, '../services/aiQueue': {},
        '../models/TagSuggestion': { bulkWrite: async ops => { count += ops.length; } },
        '../models/RelatedCache': { deleteOne: async () => { invalidated = true; } },
    });
    return { record: () => record, writes: () => writes, count: () => count, invalidated: () => invalidated,
        role: value => { role = value; },
        async submit(body) {
            let status = 200, data;
            const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; } };
            await adminAddTag({ params: { id: 'a'.repeat(24) }, user: { id: 'admin' }, body }, res);
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
