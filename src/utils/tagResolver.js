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

/**
 * Match longest known phrases before removing filler words. Each resulting
 * concept remains mandatory, with translations/legacy spellings as alternatives.
 * Unknown plurals stay intact unless their singular is in the vocabulary.
 */
async function resolveSearchConcepts(query, ignoredWords = new Set()) {
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
    return concepts.map(concept => {
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
}

module.exports = { resolveToCanonical, resolveTagsArray, resolveSearchConcepts };
