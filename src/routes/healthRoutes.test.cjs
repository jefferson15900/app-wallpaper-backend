const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const router = require('./healthRoutes');

test('readiness requires a connected and responding database and is never cached', async () => {
    const connection = mongoose.connection;
    const oldState = connection.readyState;
    const oldDb = connection.db;
    const handler = router.stack[0].route.stack[0].handle;
    let pings = 0;
    let fail = false;
    connection.db = { admin: () => ({ ping: async options => {
        pings++;
        assert.equal(options.timeoutMS, 5000);
        if (fail) throw new Error('Database unavailable');
    } }) };
    const check = async () => {
        const result = { status: 200, headers: {}, body: null };
        const res = {
            set: (key, value) => { result.headers[key] = value; },
            status: code => { result.status = code; return res; },
            json: body => { result.body = body; return res; },
        };
        await handler({}, res);
        assert.equal(result.headers['Cache-Control'], 'no-store');
        return result;
    };
    try {
        // Avoid connection events: only the driver's state is relevant here.
        connection._readyState = 2;
        let result = await check();
        assert.equal(result.status, 503);
        assert.deepEqual(result.body, { ready: false });
        assert.equal(pings, 0);

        connection._readyState = 1;
        result = await check();
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { ready: true });

        fail = true;
        result = await check();
        assert.equal(result.status, 503);
        assert.deepEqual(result.body, { ready: false });
    } finally {
        connection._readyState = oldState;
        connection.db = oldDb;
    }
});
