const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanTags } = require('./tags');

test('cleanTags preserves long tags while normalizing and deduplicating', () => {
  const longTag = 'paisaje '.repeat(30).trim();
  assert.deepEqual(cleanTags(['  ' + longTag.toUpperCase() + '  ', longTag]), [longTag]);
  const longWord = 'x'.repeat(200);
  assert.deepEqual(cleanTags([longWord]), [longWord]);
});

test('cleanTags retains content validation and tag count limits', () => {
  assert.deepEqual(cleanTags([null, 5, {}, '', ' ', 'a', '123', '!!!']), []);
  assert.deepEqual(cleanTags(['anime', 'anime', 'paisaje'], { maxTags: 1 }), ['anime']);
});
