const { normalizeTerm } = require('./wallpaperMetadata');

const STOP_WORDS = new Set(['wallpaper', 'wallpapers', 'fondo', 'fondos', 'pantalla', 'pantallas',
    'screensaver', 'screen', 'screens', 'background', 'backgrounds', 'de', 'para', 'la', 'el', 'en', 'con',
    'un', 'una', 'unos', 'unas', 'los', 'las', 'del', 'al', 'a', 'an', 'the', 'of', 'in', 'with', 'y', 'and']);
const LIVE_INTENT_WORDS = new Set(['live', 'video', 'gif', 'animated', 'animado', 'animados', 'movimiento', 'dinamico', 'dinamicos', 'dinamica']);
const IGNORED_SEARCH_WORDS = new Set([...STOP_WORDS, ...LIVE_INTENT_WORDS]);
const SEARCH_TEXT_PATHS = ['tags', 'searchDescriptions'];
const SEARCH_VERSION = 'metadata-text-v7-attributes-variety15';

function normalizeSearchText(query) {
    // Sentence punctuation separates words; keep apostrophes, hyphens and plus
    // signs used by names. Do not change normalization of stored metadata.
    return normalizeTerm(query || '').replace(/[¿?¡!.,;:()[\]{}"“”«»]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanSearchQuery(query) {
    const text = normalizeSearchText(query);
    // Keep filler words until phrase resolution (e.g. "luz de luna").
    return { text, isLive: text.split(/\s+/).some(word => LIVE_INTENT_WORDS.has(word)) };
}

function searchWordFuzzy(word, useFuzzy) {
    return useFuzzy && word.length > 3 ? { maxEdits: word.length >= 8 ? 2 : 1, prefixLength: 0 } : null;
}

function requiredSearchConcepts(concepts, useFuzzy = false) {
    return concepts.map(concept => ({ compound: {
        should: concept.alternatives.map(term => ({ compound: {
            must: term.split(/\s+/).filter(Boolean).map(word => {
                const fuzzy = searchWordFuzzy(word, useFuzzy);
                return { text: { query: word, path: SEARCH_TEXT_PATHS, matchCriteria: 'all', ...(fuzzy ? { fuzzy } : {}) } };
            }),
        } })), minimumShouldMatch: 1,
    } }));
}

module.exports = { cleanSearchQuery, normalizeSearchText, IGNORED_SEARCH_WORDS, requiredSearchConcepts, searchWordFuzzy, SEARCH_TEXT_PATHS, SEARCH_VERSION };
