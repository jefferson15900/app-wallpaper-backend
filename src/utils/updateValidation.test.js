const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateUpdate } = require('./updateValidation');
const a = 'a'.repeat(24), b = 'b'.repeat(24);
test('normalizes text and deduplicates selected wallpapers', () => {
    assert.deepEqual(validateUpdate({ text: ' Naruto ', wallpaperIds: [a, a, b], coverWallpaperId: b }).value,
        { text: 'Naruto', wallpaperIds: [a, b], coverWallpaperId: b });
});
test('rejects invalid input and covers outside the selected group', () => {
    for (const body of [null, [], 'invalid', {}, { text: 'x', wallpaperIds: [a], coverWallpaperId: b },
        { text: 'x', wallpaperIds: ['bad'], coverWallpaperId: a },
        { text: ' '.repeat(5), wallpaperIds: [a], coverWallpaperId: a },
        { text: 'x'.repeat(161), wallpaperIds: [a], coverWallpaperId: a },
        { text: 'x', wallpaperIds: Array(101).fill(a), coverWallpaperId: a }]) {
        assert.ok(validateUpdate(body).error);
    }
});
