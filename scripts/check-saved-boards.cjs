const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');

const viewer = new mongoose.Types.ObjectId();
const otherViewer = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const id = new mongoose.Types.ObjectId();
const saved = new Map([[String(viewer), []], [String(otherViewer), []]]);
let board = { _id: id, user: owner, isPrivate: false, name: 'Space', wallpapers: [
    { imageUrl: 'approved', status: 'approved' }, { imageUrl: 'hidden', status: 'pending' },
] };
let eligible = true;
let writes = 0;
const query = value => ({ select: () => ({ lean: async () => value }) });
const User = {
    findById: userId => query({ savedBoards: saved.get(String(userId)) }),
    findOne: filter => {
        assert.equal(filter.isActive.$ne, false);
        assert.deepEqual(JSON.parse(JSON.stringify(filter.$or)), [{ isVerified: true }, { role: 'admin' }]);
        return query(eligible ? { _id: owner } : null);
    },
    find: filter => {
        assert.equal(filter.isActive.$ne, false);
        return query(eligible ? [{ _id: owner }] : []);
    },
    updateOne: async (filter, update) => {
        writes++;
        const list = saved.get(String(filter._id));
        if (!list) return { matchedCount: 0 };
        if (update.$addToSet && !list.some(value => String(value) === String(update.$addToSet.savedBoards))) list.push(update.$addToSet.savedBoards);
        if (update.$pull) saved.set(String(filter._id), list.filter(value => String(value) !== String(update.$pull.savedBoards)));
        return { matchedCount: 1 };
    },
};
const Board = {
    findOne: filter => {
        assert.equal(filter.isPrivate, false);
        return query(board && !board.isPrivate ? board : null);
    },
    aggregate: async pipeline => {
        const match = pipeline[0].$match;
        assert.equal(match.isPrivate, false);
        assert.equal(pipeline[1].$lookup.pipeline[0].$match.status, 'approved');
        assert.equal(pipeline[2].$project.previews.$slice[1], 3);
        if (!board || board.isPrivate || !match._id.$in.some(value => String(value) === String(id)) || !match.user.$in.length) return [];
        const visible = board.wallpapers.filter(item => item.status === 'approved');
        return [{ _id: id, name: board.name, wallpaperCount: visible.length, previews: visible.slice(0, 3) }];
    },
};
const controller = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/controllers/savedBoardController'), 'utf8'), {
    exports: controller, console,
    require: name => name === 'mongoose' ? mongoose : name.endsWith('/Board') ? Board : User,
});
async function call(method, user = viewer, boardId = id) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await controller[method]({ user: { id: String(user) }, params: { id: String(boardId) } }, res);
    return res;
}
(async () => {
    assert.equal((await call('save', viewer, 'invalid')).code, 400);
    assert.equal(writes, 0);
    assert.equal((await call('save', owner)).code, 400, 'Cannot bookmark an owned board');
    board.isPrivate = true;
    assert.equal((await call('save')).code, 404);
    board.isPrivate = false;
    eligible = false;
    assert.equal((await call('save')).code, 404);
    eligible = true;
    await call('save');
    await call('save');
    assert.equal(saved.get(String(viewer)).length, 1, 'Saving is idempotent');
    assert.equal((await call('list', otherViewer)).body.items.length, 0, 'Bookmarks belong to the requesting user');
    let result = (await call('list')).body;
    assert.equal(result.items[0].wallpaperCount, 1);
    board.name = 'Updated by organizer';
    board.wallpapers.push({ imageUrl: 'new', status: 'approved' });
    result = (await call('list')).body;
    assert.equal(result.items[0].name, board.name);
    assert.equal(result.items[0].wallpaperCount, 2, 'Reads reflect the original board');
    board.isPrivate = true;
    assert.equal((await call('list')).body.items.length, 0);
    board.isPrivate = false;
    eligible = false;
    assert.equal((await call('list')).body.items.length, 0);
    eligible = true;
    board = null;
    assert.equal((await call('list')).body.items.length, 0);
    await call('remove');
    await call('remove');
    assert.equal(saved.get(String(viewer)).length, 0, 'Can remove unavailable boards repeatedly');
    const router = require('../src/routes/boardRoutes');
    assert.equal(require('../src/models/User').schema.path('savedBoards').options.select, false,
        'Public profile queries must not expose a user’s saved collections');
    const auth = require('../src/middleware/authMiddleware');
    for (const [path, method] of [['/saved', 'get'], ['/:id/save', 'put'], ['/:id/save', 'delete']]) {
        const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
        assert.equal(route.stack[0].handle, auth, 'Every saved-board endpoint requires authentication');
    }
    console.log('OK: saved-board ownership, idempotence, account isolation, live content, privacy, moderation and authenticated routes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
