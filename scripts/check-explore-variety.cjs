// Run: node scripts/check-explore-variety.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sourceRoutes, selectExploreRoutes } = require('../src/utils/exploreRoutes');

const candidate = (field, term, id, imageUrl = `https://images.test/${id}.jpg`) => ({
    field, term, wallpaperId: id, imageUrl, imageIndex: 0, count: 20,
});
const choose = rows => selectExploreRoutes(rows.map(({ field, term }) => ({ field, term })), rows);
const rows = [
    candidate('styles', 'anime', 'a'), candidate('subjects', 'girl', 'b'),
    candidate('extraTags', 'anime girl', 'c'), candidate('characters', 'hinata', 'd'),
    candidate('franchises', 'naruto shippuden', 'e'), candidate('environments', 'night', 'f'),
    candidate('colors', 'purple', 'g'),
];
assert.deepEqual(choose(rows).map(row => row.term), ['hinata', 'naruto shippuden', 'night', 'purple']);
assert.deepEqual(choose([]), []);
assert.equal(choose([rows[3]]).length, 1, 'never fill a minimum quota');
assert.deepEqual(choose([candidate('subjects', 'girl', 'a'), candidate('extraTags', 'anime girl', 'b')])
    .map(row => row.term), ['girl'], 'compound tags do not repeat the same subject');
assert.equal(choose([candidate('subjects', 'girl', 'a'), candidate('tags', 'chicas', 'b')]).length, 1);
assert.equal(choose([candidate('franchises', 'naruto', 'a'), candidate('tags', 'naruto shippuden', 'b')]).length, 1);
assert.equal(choose([candidate('colors', 'blue', 'a'), candidate('colors', 'purple', 'b')]).length, 1);
const alternatives = [candidate('characters', 'hinata', 'a'), candidate('environments', 'night', 'a'),
    candidate('environments', 'night', 'b')];
assert.deepEqual(choose(alternatives).map(row => row.wallpaperId), ['a', 'b'], 'choose an unused cover');
assert.equal(choose(alternatives.slice(0, 2)).length, 1, 'omit a route with no unique publication');
assert.equal(choose([candidate('characters', 'hinata', 'a', 'https://images.test/same.jpg'),
    candidate('environments', 'night', 'b', 'https://images.test/same.jpg')]).length, 1);
assert.equal(choose(['a', 'b', 'c'].flatMap(id => [candidate('characters', 'hinata', id),
    candidate('franchises', 'naruto', id)])).length, 1, 'omit concepts leading to the same pool');
assert.deepEqual(selectExploreRoutes([{ field: 'characters', term: 'hinata' }],
    [candidate('colors', 'blue', 'a')]), [], 'never fill with unrelated co-occurring concepts');
assert.ok(!('count' in choose(rows)[0]));
assert.deepEqual(sourceRoutes({ tags: [], metadata: {} }), []);

async function checkController() {
    let pipeline;
    let aggregateCalls = 0;
    let original = { _id: 'a'.repeat(24), imageUrl: 'https://images.test/original.jpg', metadata: { characters: ['hinata'] } };
    const controller = { exports: {} };
    const mongoose = { isValidObjectId: value => /^[a-f\d]{24}$/i.test(value), Types: { ObjectId: class {
        constructor(value) { this.value = value; }
    } } };
    const Wallpaper = {
        findOne: () => ({ select: () => ({ lean: async () => original }) }),
        aggregate: value => {
            pipeline = value; aggregateCalls++;
            return { option: async () => [candidate('characters', 'hinata', 'b'.repeat(24))] };
        },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/controllers/exploreController'), 'utf8'), {
        exports: controller.exports,
        require: name => name === 'mongoose' ? mongoose : name === '../models/Wallpaper' ? Wallpaper : require('../src/utils/exploreRoutes'),
    });
    const request = async query => {
        let code = 200, body;
        const res = { status(value) { code = value; return this; }, json(value) { body = value; } };
        await controller.exports.getExploreOptions({ params: { id: 'a'.repeat(24) }, query }, res);
        return { code, body };
    };
    assert.equal((await request({ exclude: 'b'.repeat(24) })).code, 200);
    assert.equal(pipeline[0].$match._id.$nin[1].value, 'b'.repeat(24), 'exclude recent publications before sampling');
    assert.ok(pipeline.some(stage => stage.$match?.['assets.imageUrl']?.$nin.includes(original.imageUrl)));
    assert.equal(pipeline.find(stage => stage.$group?.targets).$group.targets.$topN.n, 12);
    assert.equal(pipeline.find(stage => stage.$group?.target).$group._id.wallpaperId, '$_id');
    for (const exclude of ['bad', ['b'.repeat(24)], Array(31).fill('b'.repeat(24)).join(',')]) {
        assert.equal((await request({ exclude })).code, 400);
    }
    original = { ...original, metadata: {} };
    const before = aggregateCalls;
    assert.equal((await request({})).body.length, 0);
    assert.equal(aggregateCalls, before, 'no random filler query when source has no metadata');
}
checkController().then(() => console.log('Explore variety checks passed.')).catch(error => {
    console.error(error); process.exitCode = 1;
});
