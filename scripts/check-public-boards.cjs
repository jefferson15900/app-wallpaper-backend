const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');

const id = new mongoose.Types.ObjectId().toString();
const boardId = new mongoose.Types.ObjectId().toString();
const organizer = { _id: id, username: 'Organizador', isVerified: true, isActive: true };
let privateBoard = false;
let authorized = true;
let pipeline;
let count = 13;
const approved = { _id: 'approved', imageUrl: 'image', status: 'approved' };
const pending = { _id: 'pending', imageUrl: 'hidden', status: 'pending' };

function userQuery(filter, single = false) {
  assert.equal(filter.isActive.$ne, false);
  assert.equal(JSON.stringify(filter.$or), JSON.stringify([{ isVerified: true }, { role: 'admin' }]));
  return { select(fields) {
    assert.equal(fields, '_id username profilePic isVerified');
    return { lean: async () => authorized ? single ? organizer : [organizer] : single ? null : [] };
  } };
}
const Board = {
  aggregate: async stages => {
    pipeline = stages;
    assert.equal(stages[0].$match.isPrivate, false);
    assert.equal(stages[0].$match.user.$in[0], id);
    assert.equal(stages.find(stage => stage.$lookup).$lookup.pipeline[0].$match.status, 'approved');
    assert.equal(stages.find(stage => stage.$limit).$limit, 13);
    assert.equal(stages.at(-1).$project.previews.$slice[1], 3);
    assert.ok(!('user' in stages.at(-1).$project));
    return Array.from({ length: count }, (_, index) => ({ _id: String(index), name: 'Colección' }));
  },
  findOne: filter => {
    assert.equal(filter.isPrivate, false);
    assert.equal(filter._id, boardId);
    return { select: () => ({ populate: options => {
      assert.equal(options.match.status, 'approved');
      assert.ok(!options.select.split(' ').includes('artist'));
      return { lean: async () => privateBoard ? null : {
        _id: boardId, user: id, wallpapers: [approved, pending].filter(item => item.status === options.match.status),
      } };
    } }) };
  },
};
const exportsObject = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/controllers/publicBoardController'), 'utf8'), {
  exports: exportsObject, console,
  require: name => name === 'mongoose' ? mongoose : name.endsWith('/Board') ? Board : { find: userQuery, findOne: filter => userQuery(filter, true) },
});
async function call(method, query = {}, params = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await exportsObject[method]({ query, params }, res);
  return res;
}
(async () => {
  let result = await call('list');
  assert.equal(result.body.items.length, 12);
  assert.equal(result.body.nextCursor, '11');
  count = 2;
  result = await call('list', { q: 'a.*[b]', cursor: boardId });
  assert.equal(result.body.nextCursor, null);
  const match = pipeline[0].$match;
  assert.equal(match._id.$lt.toString(), boardId);
  assert.ok(new RegExp(match.name.$regex).test('a.*[b]'));
  assert.ok(!new RegExp(match.name.$regex).test('axb'));
  assert.equal((await call('list', { cursor: 'invalid' })).code, 400);
  assert.equal((await call('list', { organizerId: { $ne: null } })).code, 400);
  result = await call('detail', {}, { id: boardId });
  assert.equal(result.body.organizer.username, 'Organizador');
  assert.equal(result.body.wallpapers.length, 1);
  privateBoard = true;
  assert.equal((await call('detail', {}, { id: boardId })).code, 404);
  privateBoard = false;
  authorized = false;
  assert.equal((await call('detail', {}, { id: boardId })).code, 404);
  assert.equal((await call('list', { organizerId: id })).code, 404);
  assert.equal((await call('detail', {}, { id: 'invalid' })).code, 400);
  console.log('OK: public board pagination, literal search, approved content, private boards and organizer authorization.');
})().catch(error => { console.error(error); process.exitCode = 1; });
