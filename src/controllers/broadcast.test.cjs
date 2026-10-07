// Run: node --test src/controllers/broadcast.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const ids = ['12345678-1234-1234-1234-123456789001', '12345678-1234-1234-1234-123456789002'];
function harness({ tokens = ['ExponentPushToken[a]', 'ExponentPushToken[b]'], batches, receipts = {} } = {}) {
  const sent = [], cleaned = [], receiptRequests = [];
  const records = new Map(), recipientFilters = [], checkpointsAtDelivery = [];
  let batch = 0;
  const User = {
    distinct: async (field, filter) => { recipientFilters.push(filter); return filter._id ? tokens.slice(0, 1) : tokens; },
    updateMany: async (filter, update) => { cleaned.push({ filter, update }); },
  };
  const key = value => `${value.owner}:${value.requestId}`;
  const Broadcast = {
    init: async () => {},
    create: async value => {
      if (records.has(key(value))) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const campaign = { ...value, status: 'sending', result: null, createdAt: new Date().toISOString(),
        async save() { records.set(key(this), JSON.parse(JSON.stringify(this))); } };
      await campaign.save();
      return campaign;
    },
    findOne: filter => ({ lean: async () => records.get(key(filter)) }),
    find: filter => ({ sort: () => ({ limit: limit => ({ lean: async () => [...records.values()].filter(item => item.owner === filter.owner).slice(0, limit) }) }) }),
  };
  class Expo {
    static isExpoPushToken(token) { return typeof token === 'string' && /^ExponentPushToken\[.+\]$/.test(token); }
    chunkPushNotifications(messages) { return messages.map(message => [message]); }
    async sendPushNotificationsAsync(messages) {
      checkpointsAtDelivery.push([...records.values()].map(item => item.result?.accepted || 0));
      sent.push(...messages);
      const index = batch++;
      const result = batches?.[index] || [{ status: 'ok', id: ids[index] }];
      if (result instanceof Error) throw result;
      return result;
    }
    chunkPushNotificationReceiptIds(values) { return [values]; }
    async getPushNotificationReceiptsAsync(values) { receiptRequests.push(values); return receipts; }
  }
  const exports = {};
  vm.runInNewContext(readFileSync(`${__dirname}/adminController.js`, 'utf8'), {
    exports, console: { error() {} }, require(name) {
      if (name === '../models/User') return User;
      if (name === '../models/Broadcast') return Broadcast;
      if (name === 'expo-server-sdk') return { Expo };
      return {};
    },
  });
  async function call(method = 'broadcast', body = { title: ' Aviso ', body: ' Nuevo arte ' }, owner = 'admin') {
    const result = { status: 200 };
    await exports[method]({ body, user: { id: owner }, params: { requestId: body?.requestId } }, {
      status(code) { result.status = code; return this; },
      json(value) { result.body = JSON.parse(JSON.stringify(value)); return this; },
    });
    return result;
  }
  return { call, sent, cleaned, receiptRequests, records, recipientFilters, checkpointsAtDelivery };
}

test('network failures never report successful delivery', async () => {
  const h = harness({ batches: [new Error('offline'), new Error('offline')] });
  const { status, body } = await h.call();
  assert.equal(status, 502);
  assert.equal(body.accepted, 0);
  assert.equal(body.failed, 2);
  assert.equal(body.dispositivosAlcanzados, 0);
});

test('successful tickets confirm acceptance without claiming phone delivery', async () => {
  const { status, body } = await harness().call();
  assert.equal(status, 200);
  assert.equal(body.accepted, 2);
  assert.equal(body.failed, 0);
  assert.deepEqual(body.receiptIds, ids);
  assert.match(body.msg, /pendiente/);
});

test('Expo ticket rejection returns the credential error', async () => {
  const h = harness({ batches: Array(2).fill([{ status: 'error', details: { error: 'InvalidCredentials' } }]) });
  const { status, body } = await h.call();
  assert.equal(status, 502);
  assert.deepEqual(body.errors, { InvalidCredentials: 2 });
  assert.deepEqual(body.receiptIds, []);
});

test('partial success counts only accepted tickets and removes expired registrations', async () => {
  const h = harness({ batches: [[{ status: 'ok', id: ids[0] }], [{ status: 'error', details: { error: 'DeviceNotRegistered' } }]] });
  const { status, body } = await h.call();
  assert.equal(status, 200);
  assert.equal(body.accepted, 1);
  assert.equal(body.failed, 1);
  assert.deepEqual(body.receiptIds, [ids[0]]);
  assert.equal(h.sent[0].title, 'Aviso');
  assert.equal(h.sent[0].channelId, 'default');
  assert.deepEqual(JSON.parse(JSON.stringify(h.cleaned[0].filter)), { pushToken: { $in: ['ExponentPushToken[b]'] } });
});

test('invalid or absent recipients cannot produce a successful empty broadcast', async () => {
  for (const tokens of [[], ['', null, 'not-a-push-token']]) {
    const h = harness({ tokens });
    assert.equal((await h.call()).status, 400);
    assert.equal(h.sent.length, 0);
  }
  const h = harness({ tokens: ['invalid', 'ExponentPushToken[a]'] });
  assert.equal((await h.call()).body.invalidTokens, 1);
});

test('blank or malformed content is rejected before contacting Expo', async () => {
  for (const body of [undefined, { title: 123, body: 'x' }, { title: '  ', body: 'x' }]) {
    const h = harness();
    const result = await h.call('broadcast', body === undefined ? null : body);
    assert.equal(result.status, 400);
    assert.equal(h.sent.length, 0);
  }
});

test('receipts distinguish handoff, credential failures, and pending results', async () => {
  const pendingId = '12345678-1234-1234-1234-123456789003';
  const h = harness({ receipts: {
    [ids[0]]: { status: 'ok' },
    [ids[1]]: { status: 'error', details: { error: 'MismatchSenderId' } },
  } });
  const { status, body } = await h.call('broadcastReceipts', { receiptIds: [...ids, ids[0], pendingId] });
  assert.equal(status, 200);
  assert.deepEqual(body, { confirmed: 1, failed: 1, pending: 1, errors: { MismatchSenderId: 1 } });
  assert.equal(h.receiptRequests[0].length, 3);
});

test('invalid receipt requests never reach Expo', async () => {
  for (const receiptIds of [[], ['bad-id'], [null], Array(1001).fill(ids[0])]) {
    const h = harness();
    assert.equal((await h.call('broadcastReceipts', { receiptIds })).status, 400);
    assert.equal(h.receiptRequests.length, 0);
  }
});

test('recovery and simultaneous requests with the same key cannot send twice', async () => {
  const h = harness();
  const content = { requestId: ids[0], title: 'Aviso', body: 'Nuevo arte', mode: 'global' };
  const results = await Promise.all([h.call('broadcast', content), h.call('broadcast', content)]);
  assert.equal(h.sent.length, 2); // Two recipients, one broadcast.
  assert.equal(h.records.size, 1);
  assert.ok(results.every(result => result.body.requestId === ids[0]));
  const recovered = await h.call('broadcast', content);
  assert.equal(recovered.body.accepted, 2);
  assert.equal(h.sent.length, 2);
});

test('a reused key cannot silently send different content', async () => {
  const h = harness();
  const content = { requestId: ids[0], title: 'Aviso', body: 'Nuevo arte' };
  await h.call('broadcast', content);
  assert.equal((await h.call('broadcast', { ...content, body: 'Otro mensaje' })).status, 409);
  assert.equal(h.sent.length, 2);
});

test('a test sends only to the administrator account and never broadens to global', async () => {
  const h = harness();
  await h.call('broadcast', { requestId: ids[0], title: 'Prueba', body: 'Hola', mode: 'test' });
  assert.equal(h.sent.length, 1);
  assert.equal(h.recipientFilters[0]._id, 'admin');
  const invalid = harness();
  assert.equal((await invalid.call('broadcast', { title: 'Prueba', body: 'Hola', mode: 'test' })).status, 400);
  assert.equal(invalid.sent.length, 0);
});

test('history and status survive the response and are scoped to the administrator', async () => {
  const h = harness();
  await h.call('broadcast', { requestId: ids[0], title: 'Aviso', body: 'Hola' });
  const status = await h.call('broadcastStatus', { requestId: ids[0] });
  assert.equal(status.body.status, 'completed');
  assert.deepEqual(status.body.receiptIds, ids);
  assert.equal((await h.call('broadcastStatus', { requestId: ids[0] }, 'another-admin')).status, 404);
  assert.equal((await h.call('broadcastHistory')).body.campaigns.length, 1);
  assert.equal((await h.call('broadcastHistory', {}, 'another-admin')).body.campaigns.length, 0);
  assert.equal((await h.call('broadcastStatus', { requestId: 'bad-id' })).status, 400);
});

test('unconfirmed Expo batches remain recoverable without automatic resending', async () => {
  const h = harness({ batches: [new Error('offline'), new Error('offline')] });
  const content = { requestId: ids[0], title: 'Aviso', body: 'Hola' };
  assert.equal((await h.call('broadcast', content)).status, 502);
  await h.call('broadcast', content);
  assert.equal(h.sent.length, 2);
  const result = await h.call('broadcastStatus', { requestId: ids[0] });
  assert.equal(result.body.failed, 2);
  assert.equal(result.body.status, 'unknown');
});

test('long content and unsupported send modes are rejected before delivery', async () => {
  for (const content of [
    { title: 'a'.repeat(121), body: 'Hola' },
    { title: 'Aviso', body: 'a'.repeat(501) },
    { title: 'Aviso', body: 'Hola', mode: 'everyone-else' },
    { title: 'Aviso', body: 'Hola', requestId: 'invalid' },
  ]) {
    const h = harness();
    assert.equal((await h.call('broadcast', content)).status, 400);
    assert.equal(h.sent.length, 0);
  }
});

test('database schema declares the unique per-administrator request index', () => {
  const Broadcast = require('../models/Broadcast');
  const unique = Broadcast.schema.indexes().find(([fields, options]) => options.unique && fields.owner === 1 && fields.requestId === 1);
  assert.ok(unique);
});

test('accepted receipt IDs are checkpointed before starting the next Expo batch', async () => {
  const h = harness();
  await h.call('broadcast', { requestId: ids[0], title: 'Aviso', body: 'Hola' });
  assert.deepEqual(h.checkpointsAtDelivery, [[0], [1]]);
});
