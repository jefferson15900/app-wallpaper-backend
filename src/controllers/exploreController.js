const mongoose = require('mongoose');
const Wallpaper = require('../models/Wallpaper');
const { EXPLORE_FIELDS, sourceRoutes, routeSearchTerms, selectExploreRoutes } = require('../utils/exploreRoutes');

function explorePipeline(original, terms) {
    const effective = field => ({ $ifNull: [`$assets.metadata.${field}`, { $ifNull: [
        `$metadata.${field}`, { $ifNull: [`$assets.aiMetadata.${field}`, []] },
    ] }] });
    const classified = { $or: [
        ...EXPLORE_FIELDS.map(field => ({ $isArray: `$metadata.${field}` })),
        { $anyElementTrue: [{ $map: { input: { $ifNull: ['$images', []] }, as: 'image', in: {
            $or: EXPLORE_FIELDS.flatMap(field => [
                { $isArray: `$$image.metadata.${field}` }, { $isArray: `$$image.aiMetadata.${field}` },
            ]),
        } } }] },
    ] };
    return [
        { $match: { status: 'approved', type: { $ne: 'video' }, _id: { $ne: original._id },
            ...(terms.length ? { tags: { $in: terms } } : {}) } },
        // ponytail: unclassified sources discover among 120 recent publications; a dedicated vocabulary index can replace this sample.
        ...(!terms.length ? [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 120 }] : []),
        { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist',
            pipeline: [{ $project: { isActive: 1 } }] } },
        { $unwind: '$artist' },
        { $match: { 'artist.isActive': { $ne: false } } },
        { $project: { metadata: 1, manualTags: 1, tags: 1, classified,
            assets: { $cond: [{ $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] }, '$images', [{ imageUrl: '$imageUrl' }]] } } },
        { $unwind: { path: '$assets', includeArrayIndex: 'imageIndex' } },
        { $match: { 'assets.imageUrl': { $type: 'string', $ne: '' } } },
        { $set: { routes: { $concatArrays: [
            ...EXPLORE_FIELDS.map(field => ({ $map: { input: effective(field), as: 'term', in: { field, term: '$$term' } } })),
            { $map: { input: { $ifNull: ['$manualTags', { $cond: ['$classified', [], { $ifNull: ['$tags', []] }] }] },
                as: 'term', in: { field: 'tags', term: '$$term' } } },
        ] } } },
        // Keep the matching image of a carousel, rather than unrelated concepts from its other images.
        ...(terms.length ? [{ $match: { 'routes.term': { $in: terms } } }] : []),
        { $unwind: '$routes' },
        { $group: { _id: { field: '$routes.field', term: '$routes.term' }, count: { $sum: 1 },
            imageUrl: { $first: '$assets.imageUrl' }, wallpaperId: { $first: '$_id' }, assetId: { $first: '$assets.assetId' },
            imageIndex: { $first: '$imageIndex' } } },
        { $set: { sourceMatch: { $in: ['$_id.term', terms] } } },
        { $sort: { sourceMatch: -1, count: -1, '_id.term': 1, '_id.field': 1 } },
        { $limit: 180 },
        { $project: { _id: 0, field: '$_id.field', term: '$_id.term', count: 1, imageUrl: 1, wallpaperId: 1, assetId: 1, imageIndex: 1 } },
    ];
}

exports.getExploreOptions = async (req, res) => {
    const { id } = req.params;
    const { assetId, imageIndex = '0' } = req.query;
    if (!mongoose.isValidObjectId(id) || typeof imageIndex !== 'string' || !/^[0-9]$/.test(imageIndex)
        || (assetId !== undefined && (typeof assetId !== 'string' || !assetId || assetId.length > 80))) {
        return res.status(400).json({ msg: 'Indica una publicación e imagen válidas.' });
    }
    try {
        const original = await Wallpaper.findOne({ _id: id, status: 'approved' })
            .select('tags manualTags metadata images').lean();
        if (!original) return res.status(404).json({ msg: 'Publicación no disponible.' });
        const image = assetId ? original.images?.find(value => value.assetId === assetId) : original.images?.[Number(imageIndex)];
        if ((assetId && !image) || (!assetId && Number(imageIndex) > 0 && !image)) {
            return res.status(400).json({ msg: 'La imagen no pertenece a esta publicación.' });
        }
        const source = sourceRoutes(original, image);
        const candidates = await Wallpaper.aggregate(explorePipeline(original, routeSearchTerms(source))).option({ maxTimeMS: 5000 });
        return res.json(selectExploreRoutes(source, candidates));
    } catch {
        return res.status(503).json({ msg: 'No se pudieron cargar las opciones. Intenta de nuevo.' });
    }
};
