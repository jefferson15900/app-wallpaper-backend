const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planLegacyWallpaper: plan } = require('./franchiseWallpaperMetadata');
const { snapshotFilter, rollbackUpdate } = require('./legacyWallpaperMetadata');

test('moves explicit series labels into the same image without losing other fields or source tags', () => {
    const record = { _id: 'one', tags: ['chainsaw man', 'anime', 'power'], manualTags: ['chainsaw man', 'anime', 'power'],
        metadataRevision: 3, metadataMigration: { runId: 'original' },
        images: [{ assetId: 'asset', imageUrl: 'url', public_id: 'id', metadata: { styles: ['anime'], characters: ['makima'], extraTags: ['chainsaw man', 'power'] }, aiMetadata: { subjects: ['girl'] } }],
    };
    const before = structuredClone(record);
    const entry = plan(record, 'run');
    assert.deepEqual(entry.after.images[0].metadata, { styles: ['anime'], characters: ['makima'], franchises: ['chainsaw man'], extraTags: ['power'] });
    assert.deepEqual(entry.after.images[0].aiMetadata, record.images[0].aiMetadata);
    assert.deepEqual(entry.after.images[0].assetId, 'asset');
    assert.equal(entry.after.metadataRevision, 4);
    assert.equal(entry.after.manualTags, undefined);
    assert.equal(entry.after.metadataMigration, undefined);
    record.tags.forEach(tag => assert.ok(entry.after.tags.includes(tag)));
    assert.deepEqual(record, before);
    assert.equal(plan({ ...record, ...entry.after }, 'second').skip, 'no_missing_franchise');
});

test('preserves carousel scope and merges existing franchises; English names replace recognized abbreviations', () => {
    const images = [{ imageUrl: 'one' }, { imageUrl: 'two' }];
    const entry = plan({ _id: 'carousel', tags: ['nte', 'endfield', 'nikke'], images,
        metadata: { franchises: ['pokemon'], extraTags: ['nte', 'endfield', 'nikke', 'lucy'] } }, 'run');
    assert.deepEqual(entry.after.metadata.franchises, ['pokemon', 'neverness to everness', 'arknights: endfield', 'goddess of victory: nikke']);
    assert.deepEqual(entry.after.metadata.extraTags, ['lucy']);
    assert.equal(entry.after.images, undefined);
    assert.equal(entry.scope, 'publication');
    ['nte', 'endfield', 'nikke'].forEach(tag => assert.ok(entry.after.tags.includes(tag)));
    assert.ok(entry.after.tags.includes('neverness to everness'));
});

test('ambiguous names, explicit empty overrides, active analysis and field limits are preserved', () => {
    const base = { _id: 'one', tags: ['pokemon'] };
    assert.equal(plan({ ...base, metadata: { extraTags: ['naruto', 'spiderman', 'lucy', 'power', 'diablo', 'disney'] } }, 'run').skip, 'no_missing_franchise');
    assert.equal(plan({ ...base, metadata: { extraTags: ['pokemon'], franchises: [] } }, 'run').skip, 'no_missing_franchise');
    assert.equal(plan({ ...base, images: [{ metadata: { extraTags: ['pokemon'] }, analysis: { status: 'processing' } }] }, 'run').skip, 'ai_in_progress');
    assert.equal(plan({ ...base, metadata: { franchises: Array.from({ length: 8 }, (_, i) => `title${i}`), extraTags: ['pokemon'] } }, 'run').skip, 'field_limit_or_invalid_value');
});

test('backups retain exact originals and guards include every metadata, image and source tag field', () => {
    const record = { _id: 'one', tags: ['pokémon'], metadata: { extraTags: ['pokémon'] } };
    const entry = plan(record, 'run');
    assert.deepEqual(entry.after.metadata.franchises, ['pokemon']);
    assert.deepEqual(entry.before.metadata, record.metadata);
    assert.deepEqual(rollbackUpdate(entry).$set.metadata, record.metadata);
    const filter = snapshotFilter(entry.id, entry.before, ['tags', 'images', 'metadataRevision']);
    assert.deepEqual(filter.tags, { $eq: ['pokémon'] });
    assert.deepEqual(filter.images, { $exists: false });
    assert.deepEqual(filter.metadataRevision, { $exists: false });
});
