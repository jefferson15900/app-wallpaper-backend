// Run: node scripts/check-search-aliases.cjs (no database connection).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mongoose = require('mongoose');
const rows = [];
let sequence = 0;

function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => key === '$or' ? value.some(part => matches(row, part))
        : value && typeof value === 'object' && '$ne' in value ? row[key] !== value.$ne
        : value && typeof value === 'object' && '$regex' in value ? new RegExp(value.$regex).test(row[key])
        : value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key])
        : String(row[key]) === String(value));
}
const query = value => ({ lean: async () => value });
function update(filter, change, options) {
    let row = rows.find(item => matches(item, filter));
    if (!row && options?.upsert) {
        row = { _id: (++sequence).toString(16).padStart(24, '0'), ...change.$setOnInsert };
        rows.push(row);
    }
    if (row && change.$set) Object.assign(row, change.$set);
    return row;
}
const TagMap = {
    find: filter => {
        let selected = rows.filter(row => matches(row, filter));
        const builder = { sort() { selected.sort((a, b) => a.original.localeCompare(b.original)); return this; },
            skip(value) { selected = selected.slice(value); return this; }, limit(value) { selected = selected.slice(0, value); return this; },
            lean: async () => selected };
        return builder;
    },
    countDocuments: async filter => rows.filter(row => matches(row, filter)).length,
    findOne: filter => query(rows.find(row => matches(row, filter))),
    findById: id => query(rows.find(row => row._id === id)),
    exists: async filter => rows.some(row => matches(row, filter)),
    updateOne: async (filter, change, options) => update(filter, change, options),
    findOneAndUpdate: (filter, change, options) => query(update(filter, change, options)),
    deleteOne: async filter => { const index = rows.findIndex(row => matches(row, filter)); if (index >= 0) rows.splice(index, 1); },
};
const file = require.resolve('../src/controllers/searchAliasesController');
const controller = {};
const localRequire = createRequire(file);
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports: controller, require: name => name.endsWith('/TagMap') ? TagMap : localRequire(name),
});
async function call(method, body = {}, params = {}, query = {}) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await controller[method]({ body, params, query }, res);
    return res;
}

(async () => {
    assert.equal((await call('save', { original: { $ne: '' }, canonical: 'gta vi' })).code, 400);
    assert.equal((await call('save', { original: 'wallpaper', canonical: 'gta vi' })).code, 400);
    assert.equal((await call('save', { original: 'x'.repeat(81), canonical: 'gta vi' })).code, 400);
    assert.equal((await call('save', { original: 'azul', canonical: 'gta vi' })).code, 409);
    let result = await call('save', { original: '  GTA 6 ', canonical: 'Grand Theft Auto VI' });
    assert.equal(result.code, 201);
    const gtaId = result.body.alias.id;
    assert.equal(result.body.alias.original, 'gta 6');
    assert.equal(rows.length, 2, 'Principal name is registered as a complete phrase');
    assert.equal((await call('save', { original: 'GTA 6', canonical: 'other' })).code, 409);
    assert.equal((await call('save', { original: 'gta vi', canonical: 'grand theft auto vi' })).code, 201);
    assert.equal((await call('save', { original: 'grand theft auto 6', canonical: 'grand theft auto vi' })).code, 201);
    assert.equal((await call('save', { original: 'other game', canonical: 'gta 6' })).code, 409, 'Alias chains are rejected');
    assert.equal((await call('save', { original: 'gta 6', canonical: 'blue' }, { id: 'invalid' })).code, 400);
    assert.equal((await call('save', { original: 'renamed', canonical: 'blue' }, { id: gtaId })).code, 409);
    const root = rows.find(row => row.original === 'grand theft auto vi');
    assert.equal((await call('remove', {}, { id: root._id })).code, 409);
    assert.equal((await call('save', { original: root.original, canonical: 'other' }, { id: root._id })).code, 409);

    const realModel = require('../src/models/TagMap');
    const originalFind = realModel.find;
    realModel.find = TagMap.find;
    try {
        const { resolveSearchConcepts } = require('../src/utils/tagResolver');
        const { IGNORED_SEARCH_WORDS } = require('../src/utils/searchQuery');
        for (const name of ['gta 6', 'gta vi', 'grand theft auto 6', 'grand theft auto vi']) {
            const concepts = await resolveSearchConcepts(name, IGNORED_SEARCH_WORDS, { spelling: false });
            assert.equal(concepts.length, 1);
            assert.equal(concepts[0].canonical, root.original);
            assert.ok(concepts[0].alternatives.includes('gta vi'));
        }
        const filtered = await resolveSearchConcepts('fondos gta 6 azul', IGNORED_SEARCH_WORDS, { spelling: false });
        assert.deepEqual(filtered.map(item => item.canonical), [root.original, 'blue']);
    } finally { realModel.find = originalFind; }

    result = await call('save', { original: 'gta 6', canonical: 'azul' }, { id: gtaId });
    assert.equal(result.body.alias.canonical, 'blue');
    assert.equal((await call('remove', {}, { id: gtaId })).code, 200);
    assert.equal((await call('remove', {}, { id: gtaId })).code, 404);
    assert.equal((await call('remove', {}, { id: 'invalid' })).code, 400);
    await call('save', { original: 'a+b', canonical: 'blue' });
    result = await call('list', {}, {}, { q: 'a+b' });
    assert.equal(result.body.total, 1, 'Search treats regex characters literally');
    assert.equal((await call('list', {}, {}, { page: -1 })).code, 400);
    for (let index = 0; index < 45; index++) rows.push({ _id: String(index), original: `extra ${index}`, canonical: 'blue' });
    result = await call('list');
    assert.equal(result.body.aliases.length, 40);
    assert.ok((await call('list', {}, {}, { page: 2 })).body.aliases.length > 0);

    // Every registered endpoint must retain both authorization middlewares.
    const auth = require('../src/middleware/authMiddleware');
    const admin = require('../src/middleware/adminMiddleware');
    const routes = [];
    const router = new Proxy({}, { get: (_, method) => (...args) => { routes.push({ method, args }); } });
    const routeFile = require.resolve('../src/routes/adminRoutes');
    vm.runInNewContext(fs.readFileSync(routeFile, 'utf8'), { module: { exports: {} }, require: name => {
        if (name === 'express') return { Router: () => router };
        if (name.endsWith('/authMiddleware')) return auth;
        if (name.endsWith('/adminMiddleware')) return admin;
        if (name.endsWith('/searchAliasesController')) return controller;
        if (name.endsWith('/cloudinary')) return { uploadCloud: { array: () => () => {} } };
        return new Proxy({}, { get: () => () => {} });
    } });
    const aliases = routes.filter(route => route.args[0].startsWith('/search-aliases'));
    assert.equal(aliases.length, 4);
    for (const route of aliases) { assert.equal(route.args[1][0], auth); assert.equal(route.args[1][1], admin); }
    const unauthorized = { status(code) { this.code = code; return this; }, json() {} };
    auth({ header: () => null }, unauthorized, () => assert.fail('Unauthenticated access'));
    assert.equal(unauthorized.code, 401);
    const User = require('../src/models/User');
    const findById = User.findById;
    User.findById = async () => ({ role: 'user' });
    try { await admin({ user: { id: new mongoose.Types.ObjectId() } }, unauthorized, () => assert.fail('Non-admin access')); }
    finally { User.findById = findById; }
    assert.equal(unauthorized.code, 403);
    console.log('OK: admin authorization, CRUD, validation, literal search, pagination, protected roots and database-driven search.');
})().catch(error => { console.error(error); process.exitCode = 1; });
