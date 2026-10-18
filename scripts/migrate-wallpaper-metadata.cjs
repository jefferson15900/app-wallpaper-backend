// Read-only by default. Applying requires an exact, hashed dry-run plan.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createHash, randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
const { isDeepStrictEqual } = require('node:util');
const mongoose = require('mongoose');
const { MIGRATION_VERSION, SNAPSHOT_FIELDS, planLegacyWallpaper, snapshotFilter, rollbackUpdate } = require('../src/utils/legacyWallpaperMetadata');
const { EJSON } = mongoose.mongo.BSON;
const PROJECT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(PROJECT, '.env'), quiet: true });

function fail(message) { throw Object.assign(new Error(message), { publicMessage: message }); }
function saveJson(filename, value) { fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function hasFields(record, expected) {
    return record && Object.entries(expected).every(([key, value]) => Object.hasOwn(record, key) && isDeepStrictEqual(record[key], value));
}
async function* entries(filename) {
    const input = fs.createReadStream(filename, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try { for await (const line of lines) { if (line.trim()) { yield EJSON.parse(line); } } }
    finally { lines.close(); input.destroy(); }
}
async function fileHash(filename) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) { hash.update(chunk); }
    return hash.digest('hex');
}
function targetFingerprint(connection) {
    const authority = process.env.MONGO_URI.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)/)?.[1];
    return createHash('sha256').update(`${authority}|${connection.db.databaseName}|wallpapers`).digest('hex');
}

async function dryRun(collection, target, output) {
    const directory = path.resolve(output || path.join(PROJECT, 'reports', 'metadata-migration', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
    fs.mkdirSync(directory, { recursive: true });
    const plan = path.join(directory, 'plan.jsonl');
    const descriptor = fs.openSync(plan, 'wx');
    const summary = { version: MIGRATION_VERSION, runId: randomUUID(), target, createdAt: new Date().toISOString(),
        scanned: 0, eligible: 0, scopes: { image: 0, publication: 0 }, skipped: {}, assignments: {}, reviewTags: {}, sourceTagsPreserved: 0,
    };
    const samples = [];
    const projection = Object.fromEntries(['_id', ...SNAPSHOT_FIELDS].map(field => [field, 1]));
    try {
        for await (const record of collection.find({}, { projection }).batchSize(100)) {
            summary.scanned++;
            const entry = planLegacyWallpaper(record, summary.runId);
            if (entry.skip) { summary.skipped[entry.skip] = (summary.skipped[entry.skip] || 0) + 1; continue; }
            fs.writeSync(descriptor, EJSON.stringify(entry) + '\n');
            summary.eligible++;
            summary.scopes[entry.scope]++;
            summary.sourceTagsPreserved += record.tags.length;
            for (const [field, terms] of Object.entries(entry.assignments)) { summary.assignments[field] = (summary.assignments[field] || 0) + terms.length; }
            for (const term of entry.reviewTags) { summary.reviewTags[term] = (summary.reviewTags[term] || 0) + 1; }
            if (samples.length < 12) { samples.push({ id: String(record._id), scope: entry.scope, tags: record.tags, metadata: entry.assignments }); }
        }
        fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    summary.planSha256 = await fileHash(plan);
    summary.samples = samples;
    saveJson(path.join(directory, 'summary.json'), summary);
    const review = Object.entries(summary.reviewTags).sort((a, b) => b[1] - a[1]);
    const report = [ '# Simulación de migración de etiquetas', '',
        `Publicaciones leídas: **${summary.scanned}**. Preparadas: **${summary.eligible}**.`,
        `Clasificación por imagen: **${summary.scopes.image}**. Campos generales de carruseles: **${summary.scopes.publication}**.`,
        `Etiquetas originales preservadas en manualTags/respaldo: **${summary.sourceTagsPreserved}**.`,
        `Omitidas: \`${JSON.stringify(summary.skipped)}\`.`, '',
        'Los nombres y términos sin asignación segura se conservan en extraTags; no se descartan ni se usan para inferir atributos de una imagen.',
        'No se utilizó IA ni se descargaron imágenes. No se modificó MongoDB en esta simulación.', '',
        '## Valores asignados por campo', '', ...Object.entries(summary.assignments).map(([field, count]) => `- ${field}: ${count}`), '',
        '## Etiquetas para revisión conservadas en extraTags', '', ...review.map(([term, count]) => `- ${term}: ${count}`), '',
        '## Ejemplos del plan', '', ...samples.flatMap(sample => [`### ${sample.id} · ${sample.scope}`, '', '```json', JSON.stringify(sample, null, 2), '```', '']),
    ].join('\n');
    fs.writeFileSync(path.join(directory, 'report.md'), report, { flag: 'wx' });
    console.log(JSON.stringify({ mode: 'dry-run', directory, scanned: summary.scanned, eligible: summary.eligible,
        scopes: summary.scopes, skipped: summary.skipped, assignments: summary.assignments, sourceTagsPreserved: summary.sourceTagsPreserved,
        reviewTerms: review.length, planSha256: summary.planSha256,
    }, null, 2));
}

async function applyPlan(collection, target, planPath) {
    const plan = path.resolve(planPath);
    const directory = path.dirname(plan);
    const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
    if (summary.version !== MIGRATION_VERSION || summary.target !== target || summary.planSha256 !== await fileHash(plan)) {
        fail('El plan no corresponde a esta base de datos, versión o contenido. Genera una simulación nueva.');
    }
    const journal = path.join(directory, 'backup-applied.jsonl');
    const descriptor = fs.openSync(journal, 'wx');
    const result = { mode: 'apply', runId: summary.runId, attempted: 0, updated: 0, conflicts: 0, verified: 0, verificationFailures: 0, backup: journal };
    let batch = [];
    async function flush() {
        if (!batch.length) { return; }
        // The durable write-ahead backup is flushed before any database mutation.
        for (const entry of batch) { fs.writeSync(descriptor, EJSON.stringify(entry) + '\n'); }
        fs.fsyncSync(descriptor);
        const written = await collection.bulkWrite(batch.map(entry => ({ updateOne: {
            filter: snapshotFilter(entry.id, entry.before, SNAPSHOT_FIELDS), update: { $set: entry.after },
        } })), { ordered: false, writeConcern: { w: 'majority' } });
        result.attempted += batch.length;
        result.updated += written.modifiedCount;
        result.conflicts += batch.length - written.matchedCount;
        const actual = await collection.find({ _id: { $in: batch.map(entry => entry.id) } }, {
            projection: Object.fromEntries(['_id', ...SNAPSHOT_FIELDS].map(field => [field, 1])),
        }).toArray();
        const byId = new Map(actual.map(record => [String(record._id), record]));
        for (const entry of batch) {
            const record = byId.get(String(entry.id));
            if (hasFields(record, entry.after)) { result.verified++; }
            else if (record?.metadataMigration?.runId === summary.runId) { result.verificationFailures++; }
        }
        batch = [];
        if (result.attempted % 1000 === 0) { console.log(JSON.stringify({ progress: result.attempted, updated: result.updated })); }
    }
    try {
        for await (const entry of entries(plan)) {
            if (entry.after?.metadataMigration?.runId !== summary.runId || !entry.id) { fail('El plan contiene una entrada no válida.'); }
            batch.push(entry);
            if (batch.length === 100) { await flush(); }
        }
        await flush();
    } finally { fs.closeSync(descriptor); }
    saveJson(path.join(directory, 'apply-result.json'), result);
    console.log(JSON.stringify(result, null, 2));
    if (result.verificationFailures || result.verified !== result.updated) { fail('La verificación no coincide con las escrituras. Conserva el respaldo y revisa el resultado.'); }
}

async function rollback(collection, target, backup) {
    const filename = path.resolve(backup);
    const summary = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), 'summary.json'), 'utf8'));
    if (summary.target !== target || summary.version !== MIGRATION_VERSION) { fail('El respaldo no corresponde a esta base de datos o migración.'); }
    const result = { mode: 'rollback', restored: 0, skipped: 0 };
    let batch = [];
    async function flush() {
        if (!batch.length) { return; }
        const restored = await collection.bulkWrite(batch.map(entry => ({ updateOne: {
            // Never undo a later manual edit, analysis or other change.
            filter: snapshotFilter(entry.id, entry.after, Object.keys(entry.after)), update: rollbackUpdate(entry),
        } })), { ordered: false, writeConcern: { w: 'majority' } });
        result.restored += restored.modifiedCount;
        result.skipped += batch.length - restored.matchedCount;
        batch = [];
    }
    for await (const entry of entries(filename)) {
        if (entry.after?.metadataMigration?.runId !== summary.runId) { fail('El respaldo contiene una entrada de otra migración.'); }
        batch.push(entry);
        if (batch.length === 100) { await flush(); }
    }
    await flush();
    console.log(JSON.stringify(result, null, 2));
}

async function main() {
    const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, plan: { type: 'string' }, rollback: { type: 'string' }, out: { type: 'string' } } });
    if (values.apply && (!values.plan || values.rollback || values['dry-run']) || values.rollback && values['dry-run']) { fail('Usa --dry-run, --apply --plan ARCHIVO o --rollback RESPALDO.'); }
    if (!process.env.MONGO_URI) { fail('Falta MONGO_URI en el entorno o .env del backend.'); }
    const connection = mongoose.createConnection(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
    try {
        await connection.asPromise();
        const collection = connection.db.collection('wallpapers');
        const target = targetFingerprint(connection);
        if (values.apply) { await applyPlan(collection, target, values.plan); }
        else if (values.rollback) { await rollback(collection, target, values.rollback); }
        else { await dryRun(collection, target, values.out); }
    } finally { await connection.close(); }
}

main().catch(error => {
    console.error(error.publicMessage || `La migración se detuvo sin mostrar credenciales: ${error.name} (${error.code || 'ERROR'}). Si hubo escrituras, conserva backup-applied.jsonl.`);
    process.exitCode = 1;
});
