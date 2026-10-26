const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseDiscoveryInterests, discoveryScore, orderDiscoveryFeed } = require('./discoveryInterests');

test('Discovery uses weighted metadata from the matching image and keeps room to explore', () => {
    const interests = parseDiscoveryInterests(JSON.stringify([
        { field: 'characters', term: 'Goku', score: 30 },
        { field: 'styles', term: 'anime', score: 12 },
        { field: 'colors', term: 'blue', score: 5 },
        { field: 'invalid', term: 'x', score: 100 },
    ]));
    assert.equal(interests.length, 3);
    const goku = { _id: 'goku', metadata: { styles: ['anime'] }, images: [
        { assetId: 'first', aiMetadata: { characters: ['Goku'] }, metadata: { characters: [] } },
        { assetId: 'second', metadata: { characters: ['Goku'], colors: ['blue'] } },
    ] };
    const anime = { _id: 'anime', metadata: { styles: ['anime'] } };
    const unknown = { _id: 'unknown', metadata: { styles: ['abstract'] } };
    assert.equal(discoveryScore(goku, interests), 47);
    assert.equal(discoveryScore(anime, interests), 12);
    assert.equal(discoveryScore(unknown, interests), 0);
    const surprise = { _id: 'surprise', metadata: { styles: ['photography'] } };
    const feed = orderDiscoveryFeed([unknown, anime, goku], interests, 3, [surprise]);
    assert.deepEqual(new Set(feed.map(item => item._id)), new Set(['goku', 'anime', 'surprise']));
    assert.equal(feed.find(item => item._id === 'goku').matchedAssetId, 'second');
    assert.deepEqual(parseDiscoveryInterests('{broken'), []);
});
