const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planLegacyWallpaper, classifyLegacyTag, snapshotFilter, rollbackUpdate } = require('./legacyWallpaperMetadata');
const { normalizeTerm, resolveMetadataAlias } = require('./wallpaperMetadata');

function record(tags, extra = {}) { return { _id: 'id', tags, imageUrl: 'cover.jpg', public_id: 'cover', ...extra }; }

test('each original label retains its value; compounds and clear names populate their fields', () => {
    const source = record(['anime girl', 'blue', 'gojo', 'jujutsu kaisen', 'unknown label']);
    const plan = planLegacyWallpaper(source, 'run');
    assert.deepEqual(plan.after.images[0].metadata, { styles: ['anime'], subjects: ['girl'], colors: ['blue'], characters: ['gojo'], extraTags: ['jujutsu kaisen', 'unknown label'] });
    assert.deepEqual(plan.after.manualTags, source.tags);
    for (const tag of source.tags) { assert.ok(plan.after.tags.includes(tag)); }
    assert.ok(plan.after.images[0].assetId);
    assert.equal(plan.after.images[0].analysis.status, 'not_requested');
    assert.equal(source.images, undefined);
});

test('carousels use general metadata and never copy guessed tags into each image', () => {
    const images = [{ imageUrl: 'one' }, { imageUrl: 'two' }];
    const plan = planLegacyWallpaper(record(['car', 'red'], { images }), 'run');
    assert.equal(plan.scope, 'publication');
    assert.deepEqual(plan.after.metadata, { subjects: ['car'], colors: ['red'] });
    assert.equal(plan.after.images, undefined);
    assert.deepEqual(images, [{ imageUrl: 'one' }, { imageUrl: 'two' }]);
});

test('known Spanish tags retain canonical English search terms without duplicates', () => {
    const plan = planLegacyWallpaper(record(['ciudad', 'city', 'noche', 'night', 'misterio']), 'run');
    assert.ok(plan.after.tags.includes('city') && plan.after.tags.includes('night'));
    assert.ok(!plan.after.tags.includes('ciudad') && !plan.after.tags.includes('noche'));
    assert.ok(plan.after.tags.includes('misterio'));
    assert.deepEqual(plan.after.manualTags, ['ciudad', 'city', 'noche', 'night', 'misterio']);
    for (const tag of plan.before.tags) { assert.ok(plan.after.tags.some(value => (resolveMetadataAlias(tag) ?? normalizeTerm(tag)) === (resolveMetadataAlias(value) ?? normalizeTerm(value)))); }
    const accented = planLegacyWallpaper(record(['david martínez', 'cyberpunk']), 'run');
    assert.deepEqual(accented.after.tags, ['david martinez', 'cyberpunk']);
    assert.deepEqual(accented.after.manualTags, ['david martínez', 'cyberpunk']);
});

test('structured, edited, untagged and oversized records are left unchanged', () => {
    assert.equal(planLegacyWallpaper(record(['anime'], { metadataVersion: 1 }), 'run').skip, 'already_structured');
    assert.equal(planLegacyWallpaper(record(['anime'], { metadata: { styles: [] } }), 'run').skip, 'existing_metadata_requires_review');
    assert.equal(planLegacyWallpaper(record([]), 'run').skip, 'missing_or_invalid_tags');
    assert.equal(planLegacyWallpaper(record(Array.from({ length: 21 }, (_, index) => `unknown${index}`)), 'run').skip, 'field_limit_or_invalid_value');
    assert.deepEqual(classifyLegacyTag('lucy').metadata, { extraTags: ['lucy'] });
    assert.deepEqual(classifyLegacyTag('power').metadata, { extraTags: ['power'] });
    assert.deepEqual(classifyLegacyTag('dark').metadata, { extraTags: ['dark'] });
});

test('snapshot guards detect concurrent changes and rollback restores absence as well as values', () => {
    const plan = planLegacyWallpaper(record(['anime']), 'run');
    const filter = snapshotFilter(plan.id, plan.before, ['tags', 'metadataRevision', 'images']);
    assert.deepEqual(filter.tags, { $eq: ['anime'] });
    assert.deepEqual(filter.metadataRevision, { $exists: false });
    assert.deepEqual(filter.images, { $exists: false });
    const restore = rollbackUpdate(plan);
    assert.deepEqual(restore.$set.tags, ['anime']);
    assert.ok(Object.hasOwn(restore.$unset, 'images') && Object.hasOwn(restore.$unset, 'metadataMigration'));
});
