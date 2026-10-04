const router = require('express').Router();
const WallpaperUpdate = require('../models/WallpaperUpdate');
const Wallpaper = require('../models/Wallpaper');
const auth = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const { validateUpdate, isId } = require('../utils/updateValidation');

// Public updates only expose approved wallpapers from active artists.
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

router.get('/', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const rows = await WallpaperUpdate.find().sort({ createdAt: -1, _id: -1 })
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

router.get('/:id', async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(400).json({ msg: 'Actualización no válida.' });
        const row = await WallpaperUpdate.findById(req.params.id).populate(populateWalls).lean();
        const update = row && serialize(row, true);
        if (!update) return res.status(404).json({ msg: 'Esta actualización ya no está disponible.' });
        res.json(update);
    } catch (error) { next(error); }
});

router.delete('/:id', [auth, isAdmin], async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(400).json({ msg: 'Actualización no válida.' });
        const row = await WallpaperUpdate.findByIdAndDelete(req.params.id);
        if (!row) return res.status(404).json({ msg: 'La actualización ya fue retirada.' });
        res.json({ msg: 'Actualización retirada.' });
    } catch (error) { next(error); }
});
module.exports = router;
