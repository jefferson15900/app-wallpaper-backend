const { effectiveMetadata, normalizeMetadata, normalizeTerm, resolveMetadataAlias, ALIASES } = require('./wallpaperMetadata');

const EXPLORE_FIELDS = ['styles', 'franchises', 'characters', 'subjects', 'environments', 'colors', 'extraTags'];

function canonicalRoute(field, value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f]/.test(value)) return '';
    return field === 'tags' ? resolveMetadataAlias(value) ?? normalizeTerm(value)
        : normalizeMetadata({ [field]: [value] })[field][0];
}

function sourceRoutes(wallpaper, image) {
    const metadata = image ? effectiveMetadata(image, wallpaper.metadata) : wallpaper.metadata || {};
    const classified = [metadata, ...(wallpaper.images || []).flatMap(asset => [asset.metadata, asset.aiMetadata])]
        .some(value => EXPLORE_FIELDS.some(field => Array.isArray(value?.[field])));
    const values = { ...metadata, tags: wallpaper.manualTags ?? (classified ? [] : wallpaper.tags) ?? [] };
    const fields = [...EXPLORE_FIELDS, 'tags'];
    const routes = [];
    // Alternate fields so eight characters cannot push colors and styles out of the suggestions.
    for (let index = 0; index < 20; index++) {
        for (const field of fields) {
            const term = canonicalRoute(field, values[field]?.[index]);
            if (term && !routes.some(route => route.term === term)) routes.push({ field, term });
        }
    }
    return routes.slice(0, 24);
}

function routeSearchTerms(routes) {
    return [...new Set(routes.flatMap(({ term }) => [term, ...Object.values(ALIASES).flatMap(dictionary => dictionary[term] || [])]))];
}

function selectExploreRoutes(source, candidates, limit = 4) {
    const available = candidates.flatMap(candidate => {
        if (![...EXPLORE_FIELDS, 'tags'].includes(candidate.field) || !candidate.imageUrl || !candidate.wallpaperId) return [];
        const term = canonicalRoute(candidate.field, candidate.term);
        return term ? [{ ...candidate, term }] : [];
    });
    const priority = ['characters', 'franchises', 'styles', 'environments', 'colors', 'subjects', 'extraTags', 'tags'];
    const relevant = available.filter(route => source.some(value => value.term === route.term))
        .sort((a, b) => priority.indexOf(a.field) - priority.indexOf(b.field));
    const selected = [];
    const chosenPools = [];
    const tokens = term => new Set(normalizeTerm(term).match(/[\p{L}\p{N}]+/gu) || []);
    const overlaps = (a, b) => {
        const left = tokens(a), right = tokens(b);
        return [...left].every(token => right.has(token)) || [...right].every(token => left.has(token));
    };
    for (const route of relevant) {
        if (selected.length >= limit) break;
        // A character is more useful than a generic subject; a known series already implies anime.
        if (route.field === 'subjects' && selected.some(value => value.field === 'characters')) continue;
        if (route.term === 'anime' && selected.some(value => ['characters', 'franchises'].includes(value.field))) continue;
        if (selected.some(value => value.field === route.field || overlaps(value.term, route.term))) continue;
        const pool = available.filter(value => value.term === route.term && value.field === route.field);
        const ids = new Set(pool.map(value => String(value.wallpaperId)));
        // ponytail: compare up to 12 representative publications per concept; semantic embeddings can refine this later.
        if (chosenPools.some(other => Math.min(ids.size, other.size) >= 2
            && [...ids].filter(id => other.has(id)).length / Math.min(ids.size, other.size) >= 0.8)) continue;
        const target = pool.find(value => !selected.some(chosen => String(chosen.wallpaperId) === String(value.wallpaperId)
            || chosen.imageUrl === value.imageUrl || (value.assetId && chosen.assetId === value.assetId)));
        if (!target) continue;
        const { count, ...option } = target;
        selected.push(option);
        chosenPools.push(ids);
    }
    return selected;
}

module.exports = { EXPLORE_FIELDS, sourceRoutes, routeSearchTerms, selectExploreRoutes };
