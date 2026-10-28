const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDiscoveryTopics, selectDiscoveryTopics, parseTopicInterests } = require('./discoveryTopics');

const wall = (id, metadata, more = {}) => ({ _id: id, status: 'approved', imageUrl: `https://example.invalid/${id}.jpg`, metadata, ...more });
const group = (prefix, metadata, more) => Array.from({ length: 4 }, (_, i) => wall(`${prefix}${i}`, metadata, more));
const find = (pool, fields) => pool.find(topic => fields.every(([field, term]) => topic.concepts.some(value => value.field === field && value.term === term)) && topic.concepts.length === fields.length);

test('topics come from four distinct approved publications and canonical metadata, never fabricated combinations', () => {
    const records = [...group('city', { subjects: ['ciudad'], environments: ['noche'] }),
        ...group('anime', { styles: ['anime'], colors: ['azul'] }),
        ...group('pending', { subjects: ['cat'] }, { status: 'pending' }),
        ...group('inactive', { subjects: ['dog'] }, { artistActive: false }),
        wall('carousel', {}, { images: Array.from({ length: 8 }, () => ({ imageUrl: 'one.jpg', metadata: { subjects: ['dragon'] } })) })];
    const before = JSON.stringify(records), pool = buildDiscoveryTopics(records);
    assert.equal(find(pool, [['subjects', 'city'], ['environments', 'night']]).ids.size, 4);
    assert.ok(find(pool, [['styles', 'anime'], ['colors', 'blue']]));
    assert.ok(!find(pool, [['subjects', 'city'], ['colors', 'blue']]));
    assert.ok(!pool.some(topic => topic.concepts.some(value => ['cat', 'dog', 'dragon'].includes(value.term))));
    assert.equal(JSON.stringify(records), before);
});

test('manual empty lists override AI and terms from different images never create a pair', () => {
    const records = group('split', {}, { images: [
        { assetId: 'city', imageUrl: 'city.jpg', metadata: { subjects: ['city'], colors: [] }, aiMetadata: { colors: ['red'] } },
        { assetId: 'rain', imageUrl: 'rain.jpg', metadata: { environments: ['rain'] } },
    ] });
    const pool = buildDiscoveryTopics(records);
    assert.ok(find(pool, [['subjects', 'city']]));
    assert.ok(find(pool, [['environments', 'rain']]));
    assert.ok(!pool.some(topic => topic.concepts.length > 1));
    assert.equal(find(pool, [['subjects', 'city']]).items[0].matchedAssetId, 'city');
    assert.ok(!pool.some(topic => topic.concepts.some(value => value.term === 'red')));
});

test('both languages share topic identity and retrieval meaning while unknown vocabulary is withheld', () => {
    const pool = buildDiscoveryTopics([...group('city', { subjects: ['city'], environments: ['night'] }),
        ...group('pokemon', { franchises: ['pokemon'] }), ...group('unknown', { styles: ['lovely futuristic vibes'] })]);
    const es = selectDiscoveryTopics(pool, 'es'), en = selectDiscoveryTopics(pool, 'en');
    assert.deepEqual(es.map(topic => topic.id), en.map(topic => topic.id));
    assert.equal(es.find(topic => topic.title === 'Ciudades de noche').query, 'ciudad noche');
    assert.equal(en.find(topic => topic.title === 'Cities at night').query, 'city night');
    assert.ok(es.some(topic => topic.title === 'Fondos de Pokémon'));
    assert.ok(en.some(topic => topic.title === 'Pokémon wallpapers'));
    assert.ok(!es.some(topic => topic.title.includes('lovely')));
    assert.ok(es.every(topic => topic.items.length === 4 && new Set(topic.items.map(item => item._id)).size === 4));
});

test('successful queries in either language reinforce the same topic without discarding unknown intent', () => {
    const records = group('city', { subjects: ['city'], environments: ['night'] });
    const searches = [{ term: 'fondos de ciudad noche', engagement: 4 }, { term: 'city night wallpapers', engagement: 7 },
        { term: 'city night wedding', engagement: 1000 }];
    const pool = buildDiscoveryTopics(records, searches);
    const topic = find(pool, [['subjects', 'city'], ['environments', 'night']]);
    assert.equal(topic.searchScore, 11);
    assert.equal(selectDiscoveryTopics(pool, 'es')[0].origin, 'search');
    assert.equal(selectDiscoveryTopics(pool, 'en')[0].id, selectDiscoveryTopics(pool, 'es')[0].id);
});

test('personal ranking is isolated per request and redundant collections are suppressed', () => {
    const pool = buildDiscoveryTopics([...group('city', { subjects: ['city'], environments: ['night'] }),
        ...group('anime', { styles: ['anime'], colors: ['blue'] }), ...group('cat', { subjects: ['cat'] })]);
    const city = selectDiscoveryTopics(pool, 'es', [{ field: 'subjects', term: 'city', score: 80 }]);
    const anime = selectDiscoveryTopics(pool, 'es', [{ field: 'styles', term: 'anime', score: 80 }]);
    assert.equal(city[0].title, 'Ciudades de noche');
    assert.equal(anime[0].title, 'Anime en azul');
    assert.equal(city.filter(topic => topic.query.includes('ciudad')).length, 1);
    assert.equal(selectDiscoveryTopics(pool, 'es')[0].personalized, false);
});

test('interest input is bounded, normalized and rejects invalid shapes', () => {
    assert.deepEqual(parseTopicInterests(undefined), []);
    assert.deepEqual(parseTopicInterests('[{"field":"tags","term":"azul","score":1000}]'), [{ field: 'tags', term: 'blue', score: 100 }]);
    for (const raw of ['{', '{}', '[null]', '[{"field":"styles","term":"anime","score":-1}]',
        '[{"field":"description","term":"anything","score":1}]', 'x'.repeat(4001)]) assert.throws(() => parseTopicInterests(raw));
});
