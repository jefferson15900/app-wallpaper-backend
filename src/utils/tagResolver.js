const TagMap = require('../models/TagMap');
const mongoose = require('mongoose');
const { LOCAL_TAG_ALIASES, resolveLocalTag, equivalentSearchTags } = require('../config/tags');
const { normalizeTerm } = require('./wallpaperMetadata');

/**
 * 🎯 RESOLVER TÉRMINO ÚNICO
 * Recibe una palabra y busca su traducción oficial o término canónico en SYNONYMS o TagMap.
 * Se usa principalmente en la barra de búsqueda.
 * 
 * @param {string} word - La palabra a traducir.
 * @returns {Promise<string>} - La palabra canónica o la original si no hay mapeo.
 */
const resolveToCanonical = async (word) => (await resolveTagsArray([word]))[0] ?? '';

/**
 * 🎯 RESOLVER ARRAY DE ETIQUETAS
 * Traduce un grupo entero de etiquetas de un golpe.
 * Se usa principalmente al subir un wallpaper nuevo o al re-etiquetar por IA.
 * 
 * @param {string[]} tagsArray - Array de etiquetas a traducir.
 * @returns {Promise<string[]>} - Array de etiquetas normalizadas y sin duplicados.
 */
const resolveTagsArray = async (tagsArray) => {
    if (!Array.isArray(tagsArray) || tagsArray.length === 0) return [];
    const terms = [...new Set(tagsArray.filter(term => typeof term === 'string').map(normalizeTerm).filter(Boolean))];
    const unknown = terms.filter(term => !LOCAL_TAG_ALIASES.has(term));
    // Una sola consulta a la DB; los conceptos explícitos de metadatos tienen prioridad.
    const mappings = unknown.length ? mappingDictionary(await findMappings({ original: { $in: unknown } })) : new Map();
    return [...new Set(terms.map(term => mappedTerm(term, mappings) ?? term))];
};

const localAlternatives = new Map();
for (const [alias, value] of LOCAL_TAG_ALIASES) {
    const canonical = resolveLocalTag(value);
    if (!localAlternatives.has(canonical)) { localAlternatives.set(canonical, new Set([canonical])); }
    localAlternatives.get(canonical).add(alias);
}

async function findMappings(filter) {
    try { return await TagMap.find(filter).lean(); }
    catch (error) {
        console.error('❌ Error al consultar alias de búsqueda:', error.message);
        return [];
    }
}

function mappingDictionary(rows) {
    return new Map(rows.map(row => [normalizeTerm(row.original), normalizeTerm(row.canonical)]));
}

function mappedTerm(term, mappings) {
    if (LOCAL_TAG_ALIASES.has(term)) { return resolveLocalTag(term); }
    const mapping = mappings.get(term);
    return mapping ? resolveLocalTag(mapping) : undefined;
}

function pluralCandidates(term) {
    if (term.length <= 3 || term.includes(' ')) { return []; }
    const candidates = [];
    if (term.endsWith('ies')) { candidates.push(term.slice(0, -3) + 'y'); }
    if (term.endsWith('ces')) { candidates.push(term.slice(0, -3) + 'z'); }
    if (term.endsWith('es')) { candidates.push(term.slice(0, -2)); }
    if (term.endsWith('s')) { candidates.push(term.slice(0, -1)); }
    return candidates;
}

// FreeDict is imported once into MongoDB. Searches never call a translation API.
// Keep senses as separate records: ribera -> bank must not learn ribera -> banco.
async function findDictionaryAlternatives(terms) {
    const alternatives = new Map();
    if (mongoose.connection?.readyState !== 1 || !terms.length) { return alternatives; }
    try {
        const rows = await mongoose.connection.collection('searchdictionary')
            .find({ terms: { $in: terms }, source: 'freedict-eng-spa' })
            .project({ terms: 1 }).sort({ _id: 1 }).limit(2000).maxTimeMS(1000).toArray();
        const requested = new Set(terms);
        for (const row of rows) {
            for (const term of row.terms) {
                if (!requested.has(term)) { continue; }
                if (!alternatives.has(term)) { alternatives.set(term, new Set()); }
                const matches = alternatives.get(term);
                for (const equivalent of row.terms) {
                    if (matches.size >= 24) { break; }
                    matches.add(equivalent);
                }
            }
        }
    } catch (error) {
        console.error('Error al consultar el diccionario bilingüe:', error.code || error.name);
    }
    return alternatives;
}

// One deletion on a short prefix retrieves insertions, deletions, substitutions
// and adjacent transpositions. Verify the complete word before accepting it.
function spellingKeys(word) {
    const prefix = word.slice(0, 7);
    return [...new Set([prefix, ...[...prefix].map((_, index) => prefix.slice(0, index) + prefix.slice(index + 1))])];
}

function oneEditApart(left, right) {
    if (left === right || Math.abs(left.length - right.length) > 1) { return false; }
    let i = 0, j = 0, edits = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) { i++; j++; continue; }
        if (++edits > 1) { return false; }
        if (left.length === right.length) {
            if (left[i] === right[j + 1] && left[i + 1] === right[j]) { i++; j++; }
            i++; j++;
        } else if (left.length > right.length) { i++; }
        else { j++; }
    }
    return edits + Number(i < left.length || j < right.length) === 1;
}

function buildSpellingIndex(terms) {
    const words = new Set(terms.map(normalizeTerm).filter(term => /^[a-z]{3,32}$/.test(term)));
    const values = [...words];
    // Packed (signature hash, word id) pairs avoid hundreds of thousands of JS
    // Map/array objects. Hash collisions are verified against the full word.
    const pairs = new BigUint64Array(values.length * 8);
    let used = 0;
    for (let id = 0; id < values.length; id++) {
        for (const key of spellingKeys(values[id])) {
            pairs[used++] = (BigInt(spellingHash(key)) << 32n) | BigInt(id);
        }
    }
    return { words, values, pairs: pairs.subarray(0, used).sort() };
}

function spellingHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) { hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); }
    return hash >>> 0;
}

function nearSpellingWords(word, index) {
    const matches = new Set();
    for (const key of spellingKeys(word)) {
        const lower = BigInt(spellingHash(key)) << 32n;
        const upper = lower | 0xffffffffn;
        let left = 0, right = index.pairs.length;
        while (left < right) {
            const middle = (left + right) >>> 1;
            if (index.pairs[middle] < lower) { left = middle + 1; } else { right = middle; }
        }
        for (let i = left; i < index.pairs.length && index.pairs[i] <= upper; i++) {
            matches.add(index.values[Number(index.pairs[i] & 0xffffffffn)]);
            if (matches.size > 4000) { return null; }
        }
    }
    return matches;
}

let dictionarySpelling;
let catalogueSpelling;
let spellingLoad;
let spellingRetryAt = 0;
async function spellingVocabulary() {
    if (mongoose.connection?.readyState !== 1 || spellingRetryAt > Date.now()) { return null; }
    if (catalogueSpelling?.expires > Date.now() && dictionarySpelling?.expires > Date.now()) {
        return { ...catalogueSpelling, dictionary: dictionarySpelling.index };
    }
    if (spellingLoad) { return spellingLoad; }
    spellingLoad = (async () => {
        if (!dictionarySpelling || dictionarySpelling.expires <= Date.now()) {
            const terms = await mongoose.connection.collection('searchdictionary')
                .distinct('terms', { source: 'freedict-eng-spa' }, { maxTimeMS: 3000 });
            dictionarySpelling = { index: buildSpellingIndex(terms), expires: Date.now() + 15 * 60000 };
        }
        const [rows, aliases] = await Promise.all([
            mongoose.connection.collection('wallpapers').aggregate([
                { $match: { status: 'approved' } }, { $unwind: '$tags' },
                { $group: { _id: '$tags', count: { $sum: 1 } } }, { $limit: 20000 },
            ], { maxTimeMS: 3000 }).toArray(),
            mongoose.connection.collection('tagmaps').find({}).project({ original: 1, canonical: 1 })
                .limit(50000).maxTimeMS(3000).toArray(),
        ]);
        // Fail closed if the catalogue outgrows this snapshot: protect rare names.
        if (rows.length >= 20000 || aliases.length >= 50000) { return null; }
        const counts = new Map();
        const terms = [...LOCAL_TAG_ALIASES.keys(), ...LOCAL_TAG_ALIASES.values()];
        for (const row of rows) {
            if (typeof row._id !== 'string') { continue; }
            const term = normalizeTerm(row._id);
            for (const value of new Set([term, ...term.split(/\s+/)])) {
                counts.set(value, Math.max(counts.get(value) || 0, row.count));
                counts.set(resolveLocalTag(value), Math.max(counts.get(resolveLocalTag(value)) || 0, row.count));
            }
            terms.push(term);
        }
        for (const row of aliases) { terms.push(row.original, row.canonical); }
        // Tokens inside exact character/franchise phrases are protected too.
        const index = buildSpellingIndex(terms.filter(term => typeof term === 'string').flatMap(term => [term, ...term.split(/\s+/)]));
        catalogueSpelling = { index, counts, expires: Date.now() + 60000 };
        return { ...catalogueSpelling, dictionary: dictionarySpelling.index };
    })().catch(error => {
        spellingRetryAt = Date.now() + 5000;
        console.error('Error al cargar el vocabulario ortográfico:', error.code || error.name);
        return null;
    }).finally(() => { spellingLoad = null; });
    return spellingLoad;
}

async function spellingPlans(concepts) {
    const unknown = concepts.filter(concept => concept.original === concept.canonical &&
        concept.alternatives.length === 1 && /^[a-z]{4,32}$/.test(concept.original));
    if (!unknown.length || unknown.length > 6) { return new Map(); }
    const vocabulary = await spellingVocabulary();
    if (!vocabulary) { return new Map(); }
    const candidatesByWord = new Map();
    for (const { original } of unknown) {
        const variants = [original, ...pluralCandidates(original)];
        if (variants.some(term => vocabulary.index.words.has(term) || vocabulary.dictionary.words.has(term))) { continue; }
        const candidates = new Set();
        let overflow = false;
        for (const variant of variants) {
            for (const index of [vocabulary.index, vocabulary.dictionary]) {
                const near = nearSpellingWords(variant, index);
                if (!near) { overflow = true; break; }
                for (const term of near) { if (oneEditApart(variant, term)) { candidates.add(term); } }
            }
        }
        if (!overflow && candidates.size && candidates.size <= 40) { candidatesByWord.set(original, [...candidates]); }
    }
    const terms = [...new Set([...candidatesByWord.values()].flat())];
    if (!terms.length) { return new Map(); }
    const [translations, learned] = await Promise.all([
        findDictionaryAlternatives(terms), findMappings({ original: { $in: terms } }),
    ]);
    const mappings = mappingDictionary(learned);
    return new Map([...candidatesByWord].map(([word, candidates]) => {
        const groups = new Map();
        for (const term of candidates) {
            const canonical = mappedTerm(term, mappings);
            const equivalents = [...new Set([term, canonical, ...(translations.get(term) || [])].filter(Boolean)
                .flatMap(equivalentSearchTags))];
            const supported = equivalents.filter(equivalent => vocabulary.counts.has(equivalent));
            const count = Math.max(0, ...supported.map(equivalent => vocabulary.counts.get(equivalent)));
            const key = canonical || (supported.length ? supported.sort().join('|') : term);
            const candidate = { term, count };
            const previous = groups.get(key);
            if (!previous || count > previous.count || count === previous.count && term.localeCompare(previous.term) < 0) {
                groups.set(key, candidate);
            }
        }
        const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
        const supported = ranked.filter(candidate => candidate.count > 0);
        return [word, { candidates: ranked.slice(0, 8), automatic: supported.length === 1 ? supported[0].term : null }];
    }));
}

async function suggestSearchCorrections(query, ignoredWords = new Set()) {
    if (normalizeTerm(query).length > 150) { return []; }
    const concepts = await resolveSearchConcepts(query, ignoredWords, { spelling: false });
    const plans = await spellingPlans(concepts);
    const words = normalizeTerm(query).split(/\s+/);
    const correctedWords = words.map(word => plans.get(word)?.automatic || word);
    const suggestions = [];
    for (const [original, plan] of plans) {
        for (const { term } of plan.candidates) {
            // Preserve every other word, including filler words and other typos.
            suggestions.push(correctedWords.map((word, index) => words[index] === original ? term : word).join(' '));
        }
    }
    return [...new Set(suggestions)].slice(0, 8);
}

/**
 * Match longest known phrases before removing filler words. Each resulting
 * concept remains mandatory, with translations/legacy spellings as alternatives.
 * Unknown plurals stay intact unless their singular is in the vocabulary.
 */
async function resolveSearchConcepts(query, ignoredWords = new Set(), options = {}) {
    const words = normalizeTerm(query).split(/\s+/).filter(Boolean);
    const spans = words.map((_, start) => {
        const result = [];
        for (let end = start + 1; end <= words.length; end++) {
            const term = words.slice(start, end).join(' ');
            // Stored metadata and learned aliases are bounded to 80 characters.
            if (term.length > 80 && end > start + 1) { break; }
            result.push({ term, end });
        }
        return result.reverse();
    });
    const candidates = new Set(spans.flat().map(span => span.term));
    words.forEach(word => pluralCandidates(word).forEach(term => candidates.add(term)));
    const [mappingRows, dictionary] = await Promise.all([
        findMappings({ original: { $in: [...candidates] } }),
        findDictionaryAlternatives([...candidates]),
    ]);
    const mappings = mappingDictionary(mappingRows);
    // Curated local/TagMap meanings take precedence over general dictionary senses.
    const searchTerm = term => mappedTerm(term, mappings) ?? (dictionary.has(term) ? term : undefined);
    const concepts = [];
    for (let start = 0; start < words.length;) {
        const phrase = spans[start].find(span => (span.end > start + 1 || !ignoredWords.has(span.term)) && searchTerm(span.term));
        if (phrase) {
            concepts.push({ original: phrase.term, canonical: searchTerm(phrase.term) });
            start = phrase.end;
            continue;
        }
        const word = words[start++];
        if (ignoredWords.has(word)) { continue; }
        const singular = pluralCandidates(word).map(searchTerm).find(Boolean);
        concepts.push({ original: word, canonical: singular ?? word });
    }
    if (!concepts.length) { return []; }
    const canonicals = [...new Set(concepts.flatMap(concept => equivalentSearchTags(concept.canonical)))];
    const reverseMappings = await findMappings({ canonical: { $in: canonicals } });
    const resolved = concepts.map(concept => {
        const equivalents = equivalentSearchTags(concept.canonical);
        const alternatives = new Set([concept.original, ...equivalents.flatMap(canonical => [canonical, ...(localAlternatives.get(canonical) || [])])]);
        if (!mappedTerm(concept.original, mappings) && !mappedTerm(concept.canonical, mappings)) {
            for (const term of dictionary.get(concept.canonical) || []) {
                alternatives.add(term);
                // Uploaded English tags may already use a local canonical label.
                for (const canonical of equivalentSearchTags(term)) { alternatives.add(canonical); }
            }
        }
        for (const row of reverseMappings) {
            const original = normalizeTerm(row.original);
            if (equivalents.includes(resolveLocalTag(row.canonical)) &&
                (!LOCAL_TAG_ALIASES.has(original) || equivalents.includes(resolveLocalTag(original)))) {
                alternatives.add(original);
            }
        }
        return { ...concept, alternatives: [...alternatives] };
    });
    if (options.spelling === false || normalizeTerm(query).length > 150) { return resolved; }
    const plans = options.corrections ? new Map(options.corrections
        .filter(item => typeof item.original === 'string' && typeof item.term === 'string' &&
            [item.original, ...pluralCandidates(item.original)].some(term => oneEditApart(term, item.term)))
        .map(item => [item.original, { automatic: item.term }])) : await spellingPlans(resolved);
    return Promise.all(resolved.map(async concept => {
        const term = plans.get(concept.original)?.automatic;
        if (!term) { return concept; }
        const [corrected] = await resolveSearchConcepts(term, ignoredWords, { spelling: false });
        if (!corrected) { return concept; }
        return { ...corrected, original: concept.original, correction: term,
            alternatives: [...new Set([concept.original, ...corrected.alternatives])] };
    }));
}

module.exports = { resolveToCanonical, resolveTagsArray, resolveSearchConcepts, suggestSearchCorrections,
    warmSearchVocabulary: spellingVocabulary, oneEditApart };
