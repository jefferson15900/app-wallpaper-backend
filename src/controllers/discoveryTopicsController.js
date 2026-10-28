const Wallpaper = require('../models/Wallpaper');
const { SearchSession } = require('../models/Analytics');
const { buildDiscoveryTopics, selectDiscoveryTopics, parseTopicInterests } = require('../utils/discoveryTopics');

const cache = new Map();
function topicPool(type) {
    const cached = cache.get(type);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const entry = { expires: Date.now() + 5 * 60000 };
    // Shared catalogue pool only. Personal interests are applied after the cache, never stored in it.
    entry.promise = (async () => {
        const wallpapers = await Wallpaper.aggregate([
            { $match: { status: 'approved', ...(type !== 'all' ? { type } : {}) } },
            { $sort: { createdAt: -1, _id: -1 } },
            { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'owner', pipeline: [{ $project: { isActive: 1 } }] } },
            { $unwind: '$owner' }, { $match: { 'owner.isActive': { $ne: false } } },
            // ponytail: cache the latest 12k approved publications; replace with a materialized topic index beyond this scale.
            { $limit: 12000 },
            { $project: { status: 1, imageUrl: 1, type: 1, price: 1, metadata: 1,
                'images.assetId': 1, 'images.imageUrl': 1, 'images.metadata': 1, 'images.aiMetadata': 1 } },
        ]).option({ maxTimeMS: 8000 });
        // Preview requests have no SearchSession. Only real searches with outcomes influence this pool.
        let searches = [];
        try {
            searches = await SearchSession.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 90 * 86400000) }, resultsCount: { $gte: 4 },
                    ...(type !== 'all' ? { mediaType: type } : {}),
                    $or: [{ opened: true }, { downloaded: true }, { liked: true }] } },
                { $group: { _id: '$term', engagement: { $sum: { $add: [1,
                    { $cond: ['$downloaded', 3, 0] }, { $cond: ['$liked', 2, 0] }] } } } },
                { $sort: { engagement: -1, _id: 1 } }, { $limit: 200 },
                { $project: { _id: 0, term: '$_id', engagement: 1 } },
            ]).option({ maxTimeMS: 3000 });
        } catch { /* Catalogue discovery remains available if analytics is unavailable. */ }
        return buildDiscoveryTopics(wallpapers, searches);
    })().catch(error => { if (cache.get(type) === entry) cache.delete(type); throw error; });
    cache.set(type, entry);
    return entry.promise;
}

exports.getDiscoveryTopics = async (req, res) => {
    const { language = 'en', interests, type = 'all' } = req.query;
    if (typeof language !== 'string' || !/^(es|en)(-[a-z0-9]{2,8})*$/i.test(language) || !['all', 'image', 'video'].includes(type)) {
        return res.status(400).json({ msg: 'Choose Spanish or English.' });
    }
    const locale = language.toLowerCase().split('-')[0];
    let profile;
    try { profile = parseTopicInterests(interests); }
    catch { return res.status(400).json({ msg: 'Invalid discovery interests.' }); }
    try {
        const topics = selectDiscoveryTopics(await topicPool(type), locale, profile);
        res.set?.('Cache-Control', 'private, no-store');
        return res.json({ version: 1, language: locale, type, topics });
    } catch (error) {
        console.error('[Discovery topics]', error.name);
        return res.status(503).json({ msg: 'Discovery unavailable.' });
    }
};
