// Node >=22.18: native TypeScript, no build step. Only needed for dictionary loading.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { XMLParser } = require('fast-xml-parser');
const mongoose = require('mongoose');
const { normalizeTerm } = require('../src/utils/wallpaperMetadata');

interface Citation { quote?: unknown; '@_type'?: string; '@_xml:lang'?: string }
interface Sense { cit?: Citation | Citation[]; sense?: Sense | Sense[]; def?: unknown }
interface Entry { form: { orth?: unknown }; gramGrp?: { pos?: unknown }; sense?: Sense | Sense[] }
interface DictionaryRow { _id: string; source: string; version: string; english: string; spanish: string[]; terms: string[]; partOfSpeech: string; definition: string }

const VERSION = '2025.11.23';
const SOURCE = 'freedict-eng-spa';
const URL = `https://download.freedict.org/dictionaries/eng-spa/${VERSION}/freedict-eng-spa-${VERSION}.src.tar.xz`;
const SHA512 = '622e8fec6c4178cb4c21e4577701c5325670f825331b07a185b4c6b810603c337e80429738a97581f68f668667910e7ad36f27332eaee2828f1f906537852fe3';
const LICENSE = 'https://creativecommons.org/licenses/by-sa/3.0/';
const directory = path.resolve(__dirname, '../reports/freedict');

function array<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string {
    if (typeof value === 'string') { return value; }
    if (value && typeof value === 'object' && '#text' in value) { return text(value['#text']); }
    return '';
}
function definitions(sense: Sense): string[] {
    return [text(sense.def), ...array(sense.sense).flatMap(definitions)].filter(Boolean);
}
function usable(value: string): boolean { return value.length > 0 && value.length <= 80 && /[\p{L}\p{N}]/u.test(value) && !/[\x00-\x1f]/.test(value); }

function parseDictionary(xml: string): { rows: DictionaryRow[]; headwords: number } {
    const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: true }).parse(xml);
    const entries: Entry[] = array(parsed.TEI?.text?.body?.entry);
    const unique = new Map<string, DictionaryRow>();
    function visit(entry: Entry, sense: Sense): void {
        const english = normalizeTerm(text(entry.form?.orth));
        const spanish: string[] = [...new Set(array(sense.cit)
            .filter(cit => cit['@_type'] === 'trans' && cit['@_xml:lang'] === 'es')
            .flatMap(cit => array(cit.quote)).map(value => normalizeTerm(text(value))).filter(usable))].sort();
        if (usable(english) && spanish.length) {
            const partOfSpeech = text(entry.gramGrp?.pos);
            const definition = definitions(sense).join('; ');
            const key = JSON.stringify([SOURCE, VERSION, english, spanish, partOfSpeech, definition]);
            const _id = createHash('sha256').update(key).digest('hex');
            unique.set(_id, { _id, source: SOURCE, version: VERSION, english, spanish,
                terms: [...new Set([english, ...spanish])], partOfSpeech, definition });
        }
        for (const child of array(sense.sense)) { visit(entry, child); }
    }
    for (const entry of entries) { for (const sense of array(entry.sense)) { visit(entry, sense); } }
    return { rows: [...unique.values()].sort((a, b) => a._id.localeCompare(b._id)), headwords: entries.length };
}

async function downloadArchive(): Promise<Buffer> {
    const archivePath = path.join(directory, 'eng-spa.src.tar.xz');
    let archive: Buffer;
    try { archive = await fs.readFile(archivePath); }
    catch (error) {
        if (error.code !== 'ENOENT') { throw error; }
        const response = await fetch(URL, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) { throw new Error(`FreeDict HTTP ${response.status}`); }
        archive = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(archivePath, archive);
    }
    if (createHash('sha512').update(archive).digest('hex') !== SHA512) { throw new Error('La descarga no coincide con SHA-512 de FreeDict.'); }
    // Extract a fixed, verified member instead of unpacking arbitrary archive paths.
    return execFileSync('tar', ['-xOf', archivePath, 'eng-spa/eng-spa.tei'], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

async function main(): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const xml = await downloadArchive();
    const { rows, headwords } = parseDictionary(xml.toString('utf8'));
    if (headwords !== 64258 || rows.length < 60000) { throw new Error('El diccionario no coincide con la versión esperada.'); }
    const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(path.join(directory, 'dictionary.jsonl'), jsonl);
    const report = { source: SOURCE, version: VERSION, sourceUrl: URL, sha512: SHA512, license: LICENSE,
        attribution: 'Karl Bartel / WikDict / FreeDict; base Wiktionary via DBnary',
        headwords, senses: rows.length, terms: new Set(rows.flatMap(row => row.terms)).size,
        archiveBytes: (await fs.stat(path.join(directory, 'eng-spa.src.tar.xz'))).size,
        xmlBytes: xml.length, jsonlBytes: Buffer.byteLength(jsonl) };
    await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (!process.argv.includes('--apply')) { return; }

    require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
    if (!process.env.MONGO_URI) { throw new Error('Falta MONGO_URI.'); }
    const connection = await mongoose.createConnection(process.env.MONGO_URI, {
        autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000,
    }).asPromise();
    try {
        const collection = connection.collection('searchdictionary');
        await collection.createIndex({ terms: 1, source: 1 }, { name: 'dictionary_terms' });
        const before = await collection.countDocuments({ source: SOURCE, version: VERSION });
        let inserted = 0;
        // Deterministic identifiers + insert-only writes make repeated imports safe.
        for (let offset = 0; offset < rows.length; offset += 500) {
            const result = await collection.bulkWrite(rows.slice(offset, offset + 500).map(row => ({ updateOne: {
                filter: { _id: row._id }, update: { $setOnInsert: row }, upsert: true,
            } })), { ordered: false });
            inserted += result.upsertedCount;
            if (offset % 10000 === 0) { console.log(JSON.stringify({ processed: Math.min(offset + 500, rows.length), total: rows.length })); }
        }
        const after = await collection.countDocuments({ source: SOURCE, version: VERSION });
        if (after !== rows.length) { throw new Error('La cantidad importada no coincide con el diccionario.'); }
        const samples = await collection.find({ terms: { $in: ['ardilla', 'malagua', 'claro de luna'] }, source: SOURCE })
            .project({ english: 1, spanish: 1, _id: 0 }).toArray();
        if (!samples.some(row => row.english === 'squirrel') || !samples.some(row => row.english === 'jellyfish') || !samples.some(row => row.english === 'moonlight')) {
            throw new Error('La verificación de traducciones importadas falló.');
        }
        const stats = await connection.db.command({ collStats: 'searchdictionary', scale: 1 });
        const result = { ...report, before, inserted, after, samples,
            databaseDataBytes: stats.size, databaseStorageBytes: stats.storageSize, databaseIndexBytes: stats.totalIndexSize };
        await connection.collection('dictionaryimports').updateOne({ _id: `${SOURCE}:${VERSION}` }, {
            $set: { ...result, importedAt: new Date() },
        }, { upsert: true });
        await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
    } finally { await connection.close(); }
}

if (require.main === module) {
    main().catch(error => {
        // Connection errors can contain credentials/hostnames; keep diagnostics bounded.
        console.error('No se pudo completar la importación:', error.code || error.name);
        process.exitCode = 1;
    });
}
module.exports = { parseDictionary };
