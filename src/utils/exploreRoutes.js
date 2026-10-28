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

function selectExploreRoutes(source, candidates, limit = 6) {
    const available = candidates.flatMap(candidate => {
        if (![...EXPLORE_FIELDS, 'tags'].includes(candidate.field) || !candidate.imageUrl || !candidate.wallpaperId) return [];
        const term = canonicalRoute(candidate.field, candidate.term);
        return term ? [{ ...candidate, term }] : [];
    });
    const selected = [];
    const add = route => {
        if (route && selected.length < limit && !selected.some(value => value.term === route.term)) selected.push(route);
    };
    for (const route of source) {
        add(available.find(value => value.term === route.term && value.field === route.field)
            || available.find(value => value.term === route.term));
        if (selected.length === limit) break;
    }
    // Co-occurring concepts offer other ways to explore when the current image has few fields.
    for (const field of [...EXPLORE_FIELDS, 'tags']) {
        if (!selected.some(route => route.field === field)) add(available.find(route => route.field === field));
    }
    available.forEach(add);
    return selected.map(({ count, ...route }) => route);
}

module.exports = { EXPLORE_FIELDS, sourceRoutes, routeSearchTerms, selectExploreRoutes };
