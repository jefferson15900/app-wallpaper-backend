const Wallpaper = require('../models/Wallpaper');
const { METADATA_FIELDS, ALIASES, normalizeTerm, normalizeMetadata } = require('../utils/wallpaperMetadata');

const vocabularyCache = new Map();

async function vocabulary(field) {
    const cached = vocabularyCache.get(field);
    if (cached && cached.expires > Date.now()) { return cached.promise; }
    const entry = { expires: Infinity };
    entry.promise = (async () => {
        // One vocabulary per field/minute, shared by concurrent requests. No catalogue writes or AI.
        const rows = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $project: { values: { $reduce: {
                input: { $cond: [{ $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] }, '$images', [{}]] },
                initialValue: [],
                in: { $setUnion: ['$$value', { $ifNull: [
                    `$$this.metadata.${field}`, { $ifNull: [`$metadata.${field}`, { $ifNull: [`$$this.aiMetadata.${field}`, []] }] },
                ] }] },
            } } } },
            { $unwind: '$values' },
            { $group: { _id: '$values', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            // ponytail: cap cached vocabulary at 10k values/field; use a dedicated index if it outgrows this.
            { $limit: 10000 },
        ]).option({ maxTimeMS: 5000 });
        const counts = new Map();
        for (const row of rows) {
            if (typeof row._id !== 'string' || row._id.length > 80 || /[\x00-\x1f]/.test(row._id)) { continue; }
            const term = normalizeMetadata({ [field]: [row._id] })[field][0];
            if (term) { counts.set(term, (counts.get(term) || 0) + row.count); }
        }
        entry.expires = Date.now() + 60000;
        return [...counts].map(([term, count]) => ({ term, count }));
    })().catch(error => { vocabularyCache.delete(field); throw error; });
    vocabularyCache.set(field, entry);
    return entry.promise;
}

exports.searchMetadataSuggestions = async (req, res) => {
    const { field, q } = req.query;
    if (!METADATA_FIELDS.includes(field) || typeof q !== 'string' || q.length > 80 || /[\x00-\x1f]/.test(q)) {
        return res.status(400).json({ msg: 'Indica un campo válido y un texto de hasta 80 caracteres.' });
    }
    const query = normalizeTerm(q);
    if (!query) { return res.json([]); }
    try {
        const values = await vocabulary(field);
        const names = term => [term, ...(ALIASES[field]?.[term] || [])];
        const results = values.filter(({ term }) => names(term).some(name => name.includes(query)))
            .sort((a, b) => Number(names(b.term).some(name => name.startsWith(query))) - Number(names(a.term).some(name => name.startsWith(query)))
                || b.count - a.count || a.term.localeCompare(b.term))
            .slice(0, 12).map(({ term }) => term);
        return res.json(results);
    } catch {
        return res.status(503).json({ msg: 'No se pudieron cargar las coincidencias. Puedes seguir escribiendo.' });
    }
};
