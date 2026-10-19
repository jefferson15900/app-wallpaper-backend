const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('./tagmap-equivalents.cjs');
const { normalizeTerm } = require('../src/utils/wallpaperMetadata');

test('the plan only adds aliases for existing concepts and preserves normalized existing aliases', () => {
    const rows = [
        { original: 'chica', canonical: 'girl', language: 'es' },
        { original: 'automóvil', canonical: 'car', language: 'es' },
        { original: 'moto', canonical: 'motorcycle', language: 'es' },
        { original: 'café', canonical: 'brown', language: 'es' },
    ];
    const snapshot = JSON.stringify(rows), plan = buildPlan(rows);
    const existing = new Set(rows.map(row => normalizeTerm(row.original)));
    const targets = new Set(rows.map(row => row.canonical));
    assert.equal(JSON.stringify(rows), snapshot);
    assert.equal(new Set(plan.inserts.map(row => row.original)).size, plan.inserts.length);
    assert.ok(plan.inserts.every(row => !existing.has(row.original) && targets.has(row.canonical)));
    assert.ok(plan.inserts.some(row => row.original === 'mujer' && row.canonical === 'girl'));
    assert.ok(plan.inserts.some(row => row.original === 'women' && row.language === 'en'));
    assert.ok(plan.inserts.some(row => row.original === 'automoviles' && row.canonical === 'car'));
    assert.ok(!plan.inserts.some(row => row.original === 'automovil' || row.original === 'cafe'));
});

test('repeated planning is deterministic and adds nothing once the plan is applied', () => {
    const rows = [{ original: 'computadora', canonical: 'computer', language: 'es' }];
    const plan = buildPlan(rows);
    assert.ok(plan.inserts.some(row => row.original === 'ordenador'));
    assert.deepEqual(buildPlan(rows), plan);
    assert.deepEqual(buildPlan([...rows, ...plan.inserts]).inserts, []);
});
