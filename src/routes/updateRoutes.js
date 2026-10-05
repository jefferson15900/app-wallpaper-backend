const router = require('express').Router();
const WallpaperUpdate = require('../models/WallpaperUpdate');
const Wallpaper = require('../models/Wallpaper');
const UpdateDismissal = require('../models/UpdateDismissal');
const auth = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const { validateUpdate, isId } = require('../utils/updateValidation');
const { retentionCutoff } = require('../services/updateRetention');

// Each signed-in account sees only available updates it hasn't dismissed.
const populateWalls = {
    path: 'wallpapers', match: { status: 'approved' },
    populate: { path: 'artist', select: 'username profilePic isVerified isActive', match: { isActive: { $ne: false } } },
};
function serialize(update, detail = false) {
    const walls = update.wallpapers.filter(w => w.artist);
    if (!walls.length) return null;
    const cover = walls.find(w => String(w._id) === String(update.coverWallpaper)) || walls[0];
    return {
        _id: update._id, text: update.text, createdAt: update.createdAt,
        coverUrl: cover.imageUrl, coverType: cover.type, wallpaperCount: walls.length,
        ...(detail ? { wallpapers: walls } : {}),
    };
}

router.get('/', auth, async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const hiddenIds = await UpdateDismissal.distinct('update', { user: req.user.id });
        const rows = await WallpaperUpdate.find({ _id: { $nin: hiddenIds }, createdAt: { $gt: retentionCutoff() } }).sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit).limit(limit).populate(populateWalls).lean();
        res.json({ items: rows.map(row => serialize(row)).filter(Boolean), hasMore: rows.length === limit });
    } catch (error) { next(error); }
});

router.post('/', [auth, isAdmin], async (req, res, next) => {
    try {
        const { value, error } = validateUpdate(req.body);
        if (error) return res.status(400).json({ msg: error });
        const walls = await Wallpaper.find({ _id: { $in: value.wallpaperIds }, status: 'approved' })
            .populate({ path: 'artist', select: '_id', match: { isActive: { $ne: false } } }).lean();
        if (walls.filter(w => w.artist).length !== value.wallpaperIds.length) {
            return res.status(400).json({ msg: 'Algunos wallpapers ya no están disponibles. Revisa tu selección.' });
        }
        const update = await WallpaperUpdate.create({ text: value.text, wallpapers: value.wallpaperIds,
            coverWallpaper: value.coverWallpaperId, author: req.user.id });
        res.status(201).json({ _id: update._id });
    } catch (error) { next(error); }
});

router.get('/:id', auth, async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(400).json({ msg: 'Actualización no válida.' });
        const row = await WallpaperUpdate.findById(req.params.id).populate(populateWalls).lean();
        const update = row && new Date(row.createdAt) > retentionCutoff() && serialize(row, true);
        if (!update) return res.status(404).json({ msg: 'Esta actualización ya no está disponible.' });
        res.json(update);
    } catch (error) { next(error); }
});

router.delete('/:id/global', [auth, isAdmin], async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(400).json({ msg: 'Actualización no válida.' });
        // Delete only the shared publication; catalogue wallpapers remain available.
        await WallpaperUpdate.findByIdAndDelete(req.params.id);
        await UpdateDismissal.deleteMany({ update: req.params.id });
        res.json({ msg: 'Actualización eliminada para todos.' });
    } catch (error) { next(error); }
});

router.delete('/:id', auth, async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(400).json({ msg: 'Actualización no válida.' });
        // Idempotent and account-scoped: never delete the shared publication or its wallpapers.
        await UpdateDismissal.updateOne(
            { user: req.user.id, update: req.params.id },
            { $setOnInsert: { user: req.user.id, update: req.params.id } },
            { upsert: true }
        );
        res.json({ msg: 'Actualización eliminada de tu buzón.' });
    } catch (error) { next(error); }
});
module.exports = router;
