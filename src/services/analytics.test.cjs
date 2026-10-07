const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const dates = require('../utils/analyticsDates');

test('Lima day boundaries handle midnight and year changes independently of host zone', () => {
    assert.equal(dates.dayKey(new Date('2026-01-01T04:59:59Z')), '2025-12-31');
    assert.equal(dates.startOfDay(new Date('2026-01-01T04:59:59Z')).toISOString(), '2025-12-31T05:00:00.000Z');
    assert.equal(dates.startOfDay(new Date('2026-01-01T05:00:00Z')).toISOString(), '2026-01-01T05:00:00.000Z');
});

test('periods contain only complete days and the comparison has equal duration', () => {
    for (const days of [7, 30, 90]) {
        const period = dates.periodFor(days, new Date('2026-10-06T17:30:00Z'));
        assert.equal(period.end.toISOString(), '2026-10-06T05:00:00.000Z');
        assert.equal(period.end - period.start, days * dates.DAY);
        assert.equal(period.start - period.previousStart, days * dates.DAY);
    }
});

test('growth never fabricates a rate for empty or incomplete comparison periods', () => {
    assert.equal(dates.changePercent(20, 10, true), 100);
    assert.equal(dates.changePercent(0, 10, true), -100);
    assert.equal(dates.changePercent(5, 0, true), null);
    assert.equal(dates.changePercent(5, 10, false), null);
});

function serviceHarness({ collide = false } = {}) {
    const visits = [], activities = [], searches = [];
    let visitorAttempts = 0;
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(`${__dirname}/analyticsService.js`, 'utf8'), {
        module, console, Date, require(name) {
            if (name.includes('analyticsDates')) return dates;
            if (name.includes('/Visitor')) return { updateOne: async (...args) => {
                visits.push(args); if (collide && !visitorAttempts++) throw Object.assign(new Error('duplicate'), { code: 11000 });
            } };
            return { DailyActivity: { updateOne: async (...args) => { activities.push(args); } },
                SearchSession: { updateOne: async (...args) => { searches.push(args); } },
                DownloadEvent: { create: async value => value }, AnalyticsState: {} };
        },
    });
    return { service: module.exports, visits, activities, searches };
}

test('invalid device IDs never create visitors or activity', async () => {
    const h = serviceHarness();
    for (const id of [null, '', 'null', 'undefined', {}, 'a'.repeat(201)]) assert.equal(await h.service.recordActivity(id), false);
    assert.equal(h.visits.length, 0); assert.equal(h.activities.length, 0);
});

test('activity preserves original cohort and changes daily key only at Lima midnight', async () => {
    const h = serviceHarness();
    for (const time of ['2026-10-06T04:50:00Z', '2026-10-06T04:59:00Z', '2026-10-06T05:01:00Z']) await h.service.recordActivity('device-123', new Date(time));
    assert.equal(h.activities[0][0].day.getTime(), h.activities[1][0].day.getTime());
    assert.equal(h.activities[2][0].day - h.activities[1][0].day, dates.DAY);
    assert.equal(h.visits[0][1].$set, undefined);
    assert.ok(h.visits[0][1].$setOnInsert.createdAt);
    assert.ok(h.visits[0][1].$max.lastActiveAt);
});

test('first-visit races retry without overwriting cohort registration', async () => {
    const h = serviceHarness({ collide: true });
    assert.equal(await h.service.recordActivity('device-123'), true);
    assert.equal(h.visits.length, 2); assert.equal(h.visits[1][1].$setOnInsert, undefined);
});

test('search recording keeps initial results and outcomes use flags without inserting phantom searches', async () => {
    const h = serviceHarness();
    await h.service.recordSearch('search_123456789', '  Anime Girl  ', 0);
    await h.service.recordSearch('search_123456789', 'Anime Girl', 12);
    assert.equal(h.searches[0][1].$setOnInsert.term, 'anime girl');
    assert.equal(h.searches[0][1].$setOnInsert.resultsCount, 0);
    assert.equal(h.searches[1][1].$set, undefined);
    await h.service.recordSearchOutcome('search_123456789', 'downloaded');
    const outcome = h.searches[2];
    assert.equal(outcome[1].$set.downloaded, true); assert.equal(outcome[1].$inc, undefined);
    assert.equal(outcome[2], undefined);
    await h.service.recordSearchOutcome({ malicious: true }, 'opened');
    await h.service.recordSearchOutcome('search_123456789', 'unexpected');
    assert.equal(h.searches.length, 3);
});

function dashboardHarness({ startedAt = '2026-09-01T12:00:00Z', empty = false } = {}) {
    const now = '2026-10-06T17:00:00Z';
    class ClockDate extends Date { constructor(value) { super(value === undefined ? now : value); } }
    const traces = [];
    const aggregate = (name, replies) => async pipeline => { traces.push({ name, pipeline }); return replies.shift() || []; };
    const models = {
        User: { countDocuments: async () => 20 },
        Visitor: { countDocuments: async () => 10, aggregate: aggregate('Visitor', [[], empty ? [] : [{ size: 2, returned: 1 }]]) },
        Wallpaper: { countDocuments: async () => 8, aggregate: aggregate('Wallpaper', [[{ count: 120 }], [{ count: 30 }], []]) },
        DailyActivity: { collection: { name: 'dailyactivities' }, aggregate: aggregate('DailyActivity', [[{ count: 4 }], [{ count: 2 }], [{ count: 1 }], [{ _id: '2026-10-05', count: 3 }]]) },
        SearchSession: { aggregate: aggregate('SearchSession', [[], [], [], [{ _id: 'current', count: 1 }], empty ? [] : [{ searches: 4, opens: 2, downloads: 1 }]]) },
        DownloadEvent: { aggregate: aggregate('DownloadEvent', [[], [{ _id: 'current', count: 10 }, { _id: 'previous', count: 5 }], [{ _id: 'removed', downloads: 4 }]]) },
        AnalyticsState: { findById: () => ({ lean: async () => ({ startedAt }) }) },
    };
    const exports = {};
    vm.runInNewContext(readFileSync(`${__dirname}/../controllers/analyticsController.js`, 'utf8'), {
        exports, console, Date: ClockDate, require(name) {
            if (name.includes('analyticsDates')) return dates;
            if (name.includes('analyticsService')) return {};
            if (name.endsWith('/Analytics')) return models;
            return models[name.split('/').pop()];
        },
    });
    return { traces, async fetch(days) {
        const result = { status: 200 };
        await exports.dashboard({ query: days === undefined ? {} : { days } }, {
            status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; },
        }); return result;
    } };
}

test('dashboard rejects unsupported periods before querying the database', async () => {
    const h = dashboardHarness();
    for (const days of ['1', '30junk', 'Infinity', '0']) assert.equal((await h.fetch(days)).status, 400);
    assert.equal(h.traces.length, 0);
});

test('dashboard reports independent conversion, preserved removed content and comparable growth', async () => {
    const h = dashboardHarness(); const result = await h.fetch('7');
    assert.equal(result.status, 200);
    assert.equal(result.body.funnel.openRate, 50); assert.equal(result.body.funnel.downloadRate, 25);
    assert.equal(result.body.overview.downloads.change, 100);
    assert.equal(result.body.content.rankings[0].wallpaper, null);
    assert.equal(result.body.content.rankings[0].downloads, 4);
    assert.equal(result.body.audience.retention.rate, 50);
    const retention = h.traces.filter(trace => trace.name === 'Visitor')[1].pipeline;
    assert.ok(retention[0].$match.createdAt); assert.equal(JSON.stringify(retention).includes('lastDownloadAt'), false);
    assert.equal(result.body.series.length, 7);
    assert.equal(result.body.series[6].date, '2026-10-05');
});

test('new instrumentation never fills unmeasured days or empty cohorts with misleading rates', async () => {
    const h = dashboardHarness({ startedAt: '2026-10-05T12:00:00Z', empty: true });
    const { body } = await h.fetch('30');
    assert.equal(body.coverage.complete, false);
    assert.equal(body.overview.active.change, null);
    assert.equal(body.overview.active.previous, null);
    assert.ok(body.series.every(day => day.active === null && day.downloads === null));
    assert.equal(body.funnel.openRate, null); assert.equal(body.audience.retention.rate, null);
});

test('maintenance rejects invalid deletion filters and age-only cleanup does not silently filter by popularity', async () => {
    const filters = [], exports = {};
    vm.runInNewContext(readFileSync(`${__dirname}/../controllers/adminController.js`, 'utf8'), {
        exports, console, Date, require(name) {
            if (name === 'expo-server-sdk') return { Expo: class {} };
            if (name.endsWith('/SearchLog')) return { deleteMany: async filter => { filters.push(filter); return { deletedCount: 3 }; } };
            return {};
        },
    });
    const cleanup = async query => {
        const result = { status: 200 };
        await exports.cleanupSearchLogs({ query }, { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } });
        return result;
    };
    for (const query of [{ olderThanDays: '-1' }, { olderThanDays: 'garbage' }, { all: 'yes' }, { minCount: '-1' }]) assert.equal((await cleanup(query)).status, 400);
    assert.equal(filters.length, 0);
    assert.equal((await cleanup({ olderThanDays: '90' })).body.deleted, 3);
    assert.equal(filters[0].count, undefined); assert.ok(filters[0].updatedAt.$lte instanceof Date);
    await cleanup({ all: 'true' }); assert.equal(Object.keys(filters[1]).length, 0);
});
