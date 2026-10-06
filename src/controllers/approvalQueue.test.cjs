const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function load({ failNotifications = false } = {}) {
  let status = 'pending', counts = 0;
  const wall = { artist: 'artist', tags: ['anime'] };
  const Wallpaper = {
    findById: async () => wall,
    findOneAndUpdate: async (filter, update) => {
      assert.equal(filter.status, 'pending');
      assert.equal(update.$set.status, 'approved');
      if (status !== 'pending') return null;
      status = 'approved'; return wall;
    },
  };
  const User = { findById(id) {
    return id === 'admin' ? { lean: async () => ({ role: 'admin' }) }
      : { populate: async () => { if (failNotifications) throw new Error('offline'); return null; } };
  } };
  const exports = {};
  vm.runInNewContext(readFileSync(`${__dirname}/adminController.js`, 'utf8'), {
    exports, console: { error() {} }, require(name) {
      if (name === '../models/Wallpaper') return Wallpaper;
      if (name === '../models/User') return User;
      if (name === '../services/tagService') return { incrementTagCounts: async () => { counts++; } };
      if (name === 'expo-server-sdk') return { Expo: class {} };
      return {};
    },
  });
  const approve = async () => {
    const result = { code: 200 };
    await exports.approveOrReject({ body: { action: 'approved' }, user: { id: 'admin' }, params: { id: 'wall' } }, {
      status(code) { result.code = code; return this; }, json(body) { result.body = body; return this; },
    });
    return result;
  };
  return { approve, counts: () => counts };
}

test('concurrent approval only increments tags once', async () => {
  const h = load();
  const results = await Promise.all([h.approve(), h.approve()]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
  assert.equal(h.counts(), 1);
});

test('a notification failure does not undo or report failure for a committed approval', async () => {
  const h = load({ failNotifications: true });
  assert.equal((await h.approve()).code, 200);
  assert.equal((await h.approve()).code, 409);
  assert.equal(h.counts(), 1);
});
