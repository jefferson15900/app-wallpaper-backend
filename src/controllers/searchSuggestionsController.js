const Wallpaper = require('../models/Wallpaper');
const TagMap = require('../models/TagMap');
const { SYNONYMS, LOCAL_TAG_ALIASES, resolveLocalTag, equivalentSearchTags } = require('../config/tags');
const { ALIASES, normalizeTerm } = require('../utils/wallpaperMetadata');
const { resolveSearchConcepts, suggestSearchCorrections, searchCompletionContext, oneEditApart } = require('../utils/tagResolver');
const { cleanSearchQuery, normalizeSearchText, IGNORED_SEARCH_WORDS, requiredSearchConcepts } = require('../utils/searchQuery');

const reviewedNames = new Map();
for (const alias of Object.keys(SYNONYMS)) { reviewedNames.set(normalizeTerm(alias), { label: alias, canonical: resolveLocalTag(alias) }); }
for (const dictionary of Object.values(ALIASES)) {
    for (const [canonical, aliases] of Object.entries(dictionary)) {
        for (const [aliasOrder, alias] of [canonical, ...aliases].entries()) {
            const term = normalizeTerm(alias);
            reviewedNames.set(term, { label: reviewedNames.get(term)?.label || alias, canonical, aliasOrder });
        }
    }
}
const cache = new Map();

async function vocabulary(type, context) {
    const key = JSON.stringify([type, normalizeTerm(context)]);
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) { return existing.promise; }
    // ponytail: 32 contexts, 10k tags each, cached for one minute. Replace with a
    // dedicated suggestion index if the catalogue vocabulary outgrows this bound.
    if (cache.size >= 32) { cache.delete(cache.keys().next().value); }
    const entry = { expires: Date.now() + 60000 };
    entry.promise = (async () => {
        const concepts = context ? await resolveSearchConcepts(context, IGNORED_SEARCH_WORDS) : [];
        const load = useFuzzy => Wallpaper.aggregate([
            ...(concepts.length ? [{ $search: { index: 'default', compound: { filter: requiredSearchConcepts(concepts, useFuzzy) } } }] : []),
            { $match: { status: 'approved', ...(type !== 'all' ? { type } : {}) } },
            { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
            { $unwind: '$artist' }, { $match: { 'artist.isActive': { $ne: false } } },
            { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }, { $limit: 10000 },
        ]).option({ maxTimeMS: 3000 });
        let rows = await load(false);
        if (!rows.length && concepts.length) { rows = await load(true); }
        const values = new Map();
        for (const row of rows) {
            if (typeof row._id !== 'string' || row._id.length > 80 || /[\x00-\x1f]/.test(row._id)) { continue; }
            const canonical = resolveLocalTag(row._id);
            values.set(canonical, { label: row._id, count: (values.get(canonical)?.count || 0) + row.count });
        }
        return values;
    })().catch(error => { cache.delete(key); throw error; });
    cache.set(key, entry);
    return entry.promise;
}

exports.searchSuggestions = async (req, res) => {
    const { q, type = 'all' } = req.query;
    if (typeof q !== 'string' || q.length > 150 || /[\x00-\x1f]/.test(q) || !['all', 'image', 'video'].includes(type)) {
        return res.status(400).json({ msg: 'Escribe hasta 150 caracteres y elige un tipo válido.' });
    }
    const query = q.trim().replace(/\s+/g, ' ');
    if (query.length < 2) { return res.json([]); }
    const finalType = type === 'all' && cleanSearchQuery(query).isLive ? 'video' : type;
    try {
        const words = query.split(' ');
        const suffixes = words.map((_, index) => ({ context: words.slice(0, index).join(' '), prefix: normalizeSearchText(words.slice(index).join(' ')) }));
        const globalValues = await vocabulary(finalType, '');
        const names = new Map(reviewedNames);
        for (const [canonical, { label }] of globalValues) { names.set(normalizeTerm(label), { label, canonical }); }
        const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const learned = await TagMap.find({ $or: suffixes.map(({ prefix }) => ({ original: { $regex: `^${escape(prefix)}` } })) })
            .sort({ original: 1 }).limit(30).lean();
        for (const row of learned) {
            const alias = normalizeTerm(row.original);
            if (!LOCAL_TAG_ALIASES.has(alias)) { names.set(alias, { label: row.original, canonical: resolveLocalTag(row.canonical) }); }
        }
        let candidates = suffixes.flatMap(suffix => [...names].filter(([name]) => name.startsWith(suffix.prefix))
            .map(([name, entry]) => ({ ...suffix, ...entry, correction: false, exact: name === suffix.prefix })));
        if (!candidates.length) {
            candidates = suffixes.filter(suffix => suffix.prefix.length >= 4).flatMap(suffix => [...names]
                .filter(([name]) => oneEditApart(suffix.prefix, name))
                .map(([, entry]) => ({ ...suffix, ...entry, correction: true, exact: false })));
        }
        candidates = candidates.map(candidate => ({ ...candidate, lookupContext: searchCompletionContext(candidate.context, candidate.canonical) }));
        const contexts = [...new Set(candidates.map(candidate => candidate.lookupContext))];
        const values = new Map(await Promise.all(contexts.map(async context => [context, context ? await vocabulary(finalType, context) : globalValues])));
        const seen = new Set();
        const suggestions = candidates.map(candidate => ({ ...candidate,
            count: equivalentSearchTags(candidate.canonical).reduce((total, canonical) => total + (values.get(candidate.lookupContext).get(canonical)?.count || 0), 0),
        })).filter(candidate => candidate.context.length + candidate.label.length + Number(Boolean(candidate.context)) <= 150 &&
            !IGNORED_SEARCH_WORDS.has(normalizeTerm(candidate.label)) && candidate.count > 0)
            .sort((a, b) => Number(b.exact) - Number(a.exact) || b.prefix.length - a.prefix.length ||
                b.count - a.count || a.label.length - b.label.length ||
                // Keep the preferred spelling when equal-length inflections share a concept (rojo/roja).
                (a.aliasOrder ?? 0) - (b.aliasOrder ?? 0) || a.label.localeCompare(b.label))
            .filter(candidate => {
                const key = JSON.stringify([normalizeTerm(candidate.context), equivalentSearchTags(candidate.canonical)[0]]);
                if (seen.has(key)) { return false; }
                seen.add(key); return true;
            }).slice(0, 8).map(candidate => {
                const text = [candidate.context, candidate.label].filter(Boolean).join(' ');
                return { label: text, query: text, kind: candidate.correction ? 'correction' : 'completion' };
            });
        // Existing mobile clients already render correction suggestions. Validate
        // the entire corrected query against the same media/artist filters.
        const corrections = await suggestSearchCorrections(query, IGNORED_SEARCH_WORDS);
        if (!corrections.length) { return res.json(suggestions); }
        const verified = await Promise.all(corrections.map(async text => {
            const concepts = await resolveSearchConcepts(text, IGNORED_SEARCH_WORDS, { spelling: false });
            if (!concepts.length) { return null; }
            const rows = await Wallpaper.aggregate([
                { $search: { index: 'default', compound: { filter: requiredSearchConcepts(concepts) } } },
                { $match: { status: 'approved', ...(finalType !== 'all' ? { type: finalType } : {}) } },
                { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
                { $unwind: '$artist' }, { $match: { 'artist.isActive': { $ne: false } } },
                { $limit: 1 }, { $project: { _id: 1 } },
            ]).option({ maxTimeMS: 1500 });
            return rows.length ? { label: text, query: text, kind: 'correction' } : null;
        }));
        const corrected = verified.filter(Boolean);
        return res.json(corrected.length ? corrected : suggestions);
    } catch (error) {
        console.error('[search suggestions]', error.message);
        return res.status(503).json({ msg: 'No se pudieron cargar las sugerencias.' });
    }
};

exports.popularSearchTags = async (req, res) => {
    const { type = 'all' } = req.query;
    if (!['all', 'image', 'video'].includes(type)) { return res.status(400).json({ msg: 'Tipo no válido.' }); }
    try {
        const values = await vocabulary(type, '');
        return res.json([...values].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, 12).map(([canonical]) => canonical));
    } catch (error) {
        return res.status(503).json({ msg: 'No se pudieron cargar las recomendaciones.' });
    }
};
