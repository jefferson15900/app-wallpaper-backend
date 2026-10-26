const { effectiveMetadata, normalizeTerm } = require('./wallpaperMetadata');

const FIELDS = new Set(['subjects', 'styles', 'colors', 'environments', 'characters', 'franchises']);

function parseDiscoveryInterests(raw) {
    if (typeof raw !== 'string' || raw.length > 4000) return [];
    try {
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries)) return [];
        return entries.slice(0, 24).flatMap(entry => {
            if (!entry || !FIELDS.has(entry.field) || typeof entry.term !== 'string'
                || entry.term.length > 80 || !Number.isFinite(entry.score)) return [];
            const term = normalizeTerm(entry.term);
            return term && entry.score > 0 ? [{ field: entry.field, term, score: Math.min(entry.score, 100) }] : [];
        });
    } catch { return []; }
}

function bestDiscoveryMatch(wallpaper, interests) {
    if (!interests.length) return { score: 0 };
    const images = wallpaper.images?.length ? wallpaper.images : [null];
    return images.map(image => {
        const metadata = image ? effectiveMetadata(image, wallpaper.metadata) : wallpaper.metadata || {};
        const score = interests.reduce((total, interest) => total +
            (Array.isArray(metadata[interest.field]) && metadata[interest.field]
                .some(value => typeof value === 'string' && normalizeTerm(value) === interest.term)
                ? interest.score : 0), 0);
        return { score, assetId: image?.assetId };
    }).reduce((best, match) => match.score > best.score ? match : best, { score: 0 });
}

function discoveryScore(wallpaper, interests) {
    return bestDiscoveryMatch(wallpaper, interests).score;
}

function orderDiscoveryFeed(wallpapers, interests, limit, discoveries = []) {
    if (!interests.length) return wallpapers.slice(0, limit);
    const ranked = wallpapers.map(item => {
        const { score, assetId } = bestDiscoveryMatch(item, interests);
        return { item: assetId ? { ...item, matchedAssetId: assetId } : item, score, tie: Math.random() };
    })
        .sort((a, b) => b.score - a.score || a.tie - b.tie);
    const personalized = ranked.filter(entry => entry.score > 0).slice(0, Math.ceil(limit * 0.75));
    const selectedIds = new Set(personalized.map(entry => String(entry.item._id)));
    const broad = discoveries.filter(item => !selectedIds.has(String(item._id)))
        .map(item => ({ item, tie: Math.random() }));
    const remaining = ranked.filter(entry => !selectedIds.has(String(entry.item._id)));
    // ponytail: a quarter comes from the full catalog; reuse the ranked pool if that sample is too small.
    const discovery = [...broad, ...remaining.filter(entry => !broad.some(value => String(value.item._id) === String(entry.item._id)))]
        .slice(0, limit - personalized.length);
    const selected = [...personalized, ...discovery];
    return selected.sort((a, b) => a.tie - b.tie).map(entry => entry.item);
}

module.exports = { parseDiscoveryInterests, discoveryScore, orderDiscoveryFeed };
