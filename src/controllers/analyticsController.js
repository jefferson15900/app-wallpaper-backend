const User = require('../models/User');
const Visitor = require('../models/Visitor');
const Wallpaper = require('../models/Wallpaper');
const { DailyActivity, SearchSession, DownloadEvent, AnalyticsState } = require('../models/Analytics');
const { recordActivity, initializeAnalytics } = require('../services/analyticsService');
const { DAY, TIMEZONE, startOfDay, dayKey, periodFor, changePercent, validDeviceId } = require('../utils/analyticsDates');

exports.ping = async (req, res) => {
    if (!validDeviceId(req.body?.deviceId)) return res.status(400).json({ msg: 'Identificador de dispositivo inválido' });
    try {
        await recordActivity(req.body.deviceId);
        return res.sendStatus(204);
    } catch (error) {
        console.error('[activity]', error.message);
        return res.status(500).json({ msg: 'No se pudo registrar la actividad' });
    }
};

const dateGroup = field => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TIMEZONE } });
const range = (start, end) => ({ $gte: start, $lt: end });
const uniqueDevices = async (start, end) => {
    const result = await DailyActivity.aggregate([
        { $match: { day: range(start, end) } }, { $group: { _id: '$deviceId' } }, { $count: 'count' },
    ]);
    return result[0]?.count || 0;
};

exports.dashboard = async (req, res) => {
    const days = req.query.days === undefined ? 7 : Number(req.query.days);
    if (![7, 30, 90].includes(days)) return res.status(400).json({ msg: 'El período debe ser 7, 30 o 90 días' });
    try {
        const now = new Date();
        const { start, end, previousStart } = periodFor(days, now);
        const state = await AnalyticsState.findById('dashboard').lean() || await initializeAnalytics();
        // Partial first days are deliberately not represented as measured zero days.
        const firstFullDay = new Date(startOfDay(new Date(state.startedAt)).getTime() + DAY);
        const complete = firstFullDay <= previousStart;
        const [active, previousActive, activeToday, newDevices, previousNewDevices, newAccounts,
            totalDevices, totalAccounts, approved, pending, galleryDownloads, galleryLikes,
            downloadDays, activityDays, searchDays, newDeviceDays, searches, opportunities,
            downloadCounts, noResultCounts, funnelRows, rankings, tags, retentionRows] = await Promise.all([
            uniqueDevices(start, end), uniqueDevices(previousStart, start), uniqueDevices(end, new Date(end.getTime() + DAY)),
            Visitor.countDocuments({ createdAt: range(start, end) }), Visitor.countDocuments({ createdAt: range(previousStart, start) }),
            User.countDocuments({ createdAt: range(start, end) }), Visitor.countDocuments(), User.countDocuments(),
            Wallpaper.countDocuments({ status: 'approved' }), Wallpaper.countDocuments({ status: 'pending' }),
            Wallpaper.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, count: { $sum: '$downloads' } } }]),
            Wallpaper.aggregate([{ $match: { status: 'approved' } }, { $project: { count: { $size: { $ifNull: ['$likes', []] } } } }, { $group: { _id: null, count: { $sum: '$count' } } }]),
            DownloadEvent.aggregate([{ $match: { createdAt: range(start, end) } }, { $group: { _id: dateGroup('createdAt'), count: { $sum: 1 } } }]),
            DailyActivity.aggregate([{ $match: { day: range(start, end) } }, { $group: { _id: dateGroup('day'), count: { $sum: 1 } } }]),
            SearchSession.aggregate([{ $match: { createdAt: range(start, end) } }, { $group: { _id: dateGroup('createdAt'), count: { $sum: 1 } } }]),
            Visitor.aggregate([{ $match: { createdAt: range(start, end) } }, { $group: { _id: dateGroup('createdAt'), count: { $sum: 1 } } }]),
            SearchSession.aggregate([
                { $match: { createdAt: range(start, end) } },
                { $group: { _id: '$term', count: { $sum: 1 }, opens: { $sum: { $cond: ['$opened', 1, 0] } }, downloads: { $sum: { $cond: ['$downloaded', 1, 0] } }, noResults: { $sum: { $cond: [{ $eq: ['$resultsCount', 0] }, 1, 0] } } } },
                { $sort: { count: -1, _id: 1 } }, { $limit: 15 },
            ]),
            SearchSession.aggregate([
                { $match: { createdAt: range(start, end) } }, { $sort: { createdAt: -1 } },
                { $group: { _id: '$term', count: { $sum: { $cond: [{ $eq: ['$resultsCount', 0] }, 1, 0] } }, latestResults: { $first: '$resultsCount' }, lastSearchedAt: { $first: '$createdAt' } } },
                { $match: { count: { $gt: 0 }, latestResults: 0 } }, { $sort: { count: -1, _id: 1 } }, { $limit: 10 },
            ]),
            DownloadEvent.aggregate([{ $match: { createdAt: range(previousStart, end) } }, { $group: { _id: { $cond: [{ $gte: ['$createdAt', start] }, 'current', 'previous'] }, count: { $sum: 1 } } }]),
            SearchSession.aggregate([{ $match: { createdAt: range(previousStart, end), resultsCount: 0 } }, { $group: { _id: { $cond: [{ $gte: ['$createdAt', start] }, 'current', 'previous'] }, count: { $sum: 1 } } }]),
            SearchSession.aggregate([{ $match: { createdAt: range(start, end) } }, { $group: { _id: null, searches: { $sum: 1 }, opens: { $sum: { $cond: ['$opened', 1, 0] } }, downloads: { $sum: { $cond: ['$downloaded', 1, 0] } } } }]),
            DownloadEvent.aggregate([
                { $match: { createdAt: range(start, end) } }, { $group: { _id: '$wallpaperId', downloads: { $sum: 1 } } },
                { $sort: { downloads: -1, _id: 1 } }, { $limit: 10 },
                { $lookup: { from: 'wallpapers', localField: '_id', foreignField: '_id', as: 'wall' } },
                { $project: { downloads: 1, wallpaper: { $arrayElemAt: ['$wall', 0] } } },
            ]),
            Wallpaper.aggregate([{ $match: { status: 'approved' } }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
            // Immutable registration cohort, with activity exactly on day 3. Today's
            // incomplete day and cohorts predating instrumentation are excluded.
            Visitor.aggregate([
                { $match: { createdAt: range(new Date(Math.max(start.getTime(), firstFullDay.getTime())), new Date(end.getTime() - 3 * DAY)) } },
                { $addFields: { returnDay: { $dateAdd: { startDate: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: TIMEZONE } }, unit: 'day', amount: 3, timezone: TIMEZONE } } } },
                { $lookup: { from: DailyActivity.collection.name, let: { device: '$deviceId', returnDay: '$returnDay' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$deviceId', '$$device'] }, { $eq: ['$day', '$$returnDay'] }] } } }, { $limit: 1 }], as: 'returnActivity' } },
                { $group: { _id: null, size: { $sum: 1 }, returned: { $sum: { $cond: [{ $gt: [{ $size: '$returnActivity' }, 0] }, 1, 0] } } } },
            ]),
        ]);
        const countOf = (rows, key) => rows.find(row => row._id === key)?.count || 0;
        const downloads = countOf(downloadCounts, 'current');
        const noResults = countOf(noResultCounts, 'current');
        const funnel = funnelRows[0] || { searches: 0, opens: 0, downloads: 0 };
        const rate = value => funnel.searches ? Math.round(value / funnel.searches * 1000) / 10 : null;
        const series = Array.from({ length: days }, (_, index) => {
            const date = new Date(start.getTime() + index * DAY);
            const key = dayKey(date), measured = date >= firstFullDay;
            return { date: key, measured, active: measured ? countOf(activityDays, key) : null,
                downloads: measured ? countOf(downloadDays, key) : null, searches: measured ? countOf(searchDays, key) : null,
                newDevices: countOf(newDeviceDays, key) };
        });
        const metric = (value, previous, comparable = complete) => ({ value, previous: comparable ? previous : null, change: changePercent(value, previous, comparable) });
        const cohort = retentionRows[0];
        return res.json({
            version: 2, generatedAt: now, period: { days, start, end, timezone: TIMEZONE, previousStart },
            coverage: { startedAt: state.startedAt, firstFullDay, complete: firstFullDay <= start, comparisonAvailable: complete },
            overview: { active: metric(active, previousActive), newDevices: metric(newDevices, previousNewDevices),
                downloads: metric(downloads, countOf(downloadCounts, 'previous')), noResults: metric(noResults, countOf(noResultCounts, 'previous')) },
            audience: { activeToday, totalDevices, totalAccounts, newAccounts,
                retention: { rate: cohort?.size ? Math.round(cohort.returned / cohort.size * 1000) / 10 : null, size: cohort?.size || 0, returned: cohort?.returned || 0 } },
            // Legacy keys keep older installed clients usable while the app rolls out.
            users: { total: totalAccounts, totalVisitors: totalDevices, dau: activeToday, newVisitorsWeek: newDevices, newWeek: newAccounts },
            content: { approved, pending, galleryDownloads: galleryDownloads[0]?.count || 0, galleryLikes: galleryLikes[0]?.count || 0,
                total: approved, downloads: galleryDownloads[0]?.count || 0, likes: galleryLikes[0]?.count || 0,
                retention: cohort?.size ? Math.round(cohort.returned / cohort.size * 1000) / 10 : 0,
                rankings: rankings.map(row => ({ id: String(row._id), downloads: row.downloads,
                    wallpaper: row.wallpaper?.status === 'approved' ? { _id: row.wallpaper._id, imageUrl: row.wallpaper.imageUrl, type: row.wallpaper.type, price: row.wallpaper.price, tags: row.wallpaper.tags, artist: row.wallpaper.artist } : null })) },
            series, tags, searches: searches.map(row => ({ term: row._id, count: row.count, opens: row.opens, clicks: row.opens, downloads: row.downloads, noResults: row.noResults })),
            opportunities: opportunities.map(row => ({ term: row._id, count: row.count, lastSearchedAt: row.lastSearchedAt })),
            contentGaps: opportunities.map(row => ({ term: row._id, count: row.count })),
            funnel: { searches: funnel.searches, opens: funnel.opens, downloads: funnel.downloads, openRate: rate(funnel.opens), downloadRate: rate(funnel.downloads) },
        });
    } catch (error) {
        console.error('[dashboard]', error);
        return res.status(500).json({ msg: 'No se pudieron cargar las estadísticas. Intenta nuevamente.' });
    }
};
