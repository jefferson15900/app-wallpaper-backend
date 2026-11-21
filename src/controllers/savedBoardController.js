const mongoose = require('mongoose');
const Board = require('../models/Board');
const User = require('../models/User');

const eligibleOrganizer = { isActive: { $ne: false }, $or: [{ isVerified: true }, { role: 'admin' }] };

exports.list = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('savedBoards').lean();
        if (!user) return res.status(401).json({ msg: 'Usuario no disponible' });
        const ids = user.savedBoards || [];
        if (!ids.length) return res.json({ ids: [], items: [] });
        const organizers = await User.find(eligibleOrganizer).select('_id').lean();
        // Resolve references on every read: private/deleted collections and unapproved media stay hidden.
        const items = await Board.aggregate([
            { $match: { _id: { $in: ids }, isPrivate: false, user: { $in: organizers.map(item => item._id) } } },
            { $lookup: { from: 'wallpapers', let: { ids: '$wallpapers' }, pipeline: [
                { $match: { status: 'approved', $expr: { $in: ['$_id', '$$ids'] } } },
                { $sort: { _id: -1 } },
                { $project: { imageUrl: 1, type: 1 } },
            ], as: 'visibleWallpapers' } },
            { $project: { name: 1, wallpaperCount: { $size: '$visibleWallpapers' },
                previews: { $slice: ['$visibleWallpapers', 3] } } },
        ]);
        const order = new Map(ids.map((id, index) => [String(id), index]));
        items.sort((a, b) => order.get(String(b._id)) - order.get(String(a._id)));
        res.json({ ids, items });
    } catch (err) {
        console.error('Error al cargar colecciones guardadas:', err);
        res.status(500).json({ msg: 'Error al cargar colecciones guardadas' });
    }
};

exports.save = async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ msg: 'ID no válido' });
        const board = await Board.findOne({ _id: req.params.id, isPrivate: false }).select('user').lean();
        const organizer = board && await User.findOne({ ...eligibleOrganizer, _id: board.user }).select('_id').lean();
        if (!board || !organizer) return res.status(404).json({ msg: 'Colección no disponible' });
        if (String(board.user) === String(req.user.id)) return res.status(400).json({ msg: 'Este tablero ya es tuyo' });
        const result = await User.updateOne({ _id: req.user.id }, { $addToSet: { savedBoards: board._id } });
        if (!result.matchedCount) return res.status(401).json({ msg: 'Usuario no disponible' });
        res.json({ saved: true });
    } catch (err) {
        console.error('Error al guardar colección:', err);
        res.status(500).json({ msg: 'Error al guardar colección' });
    }
};

exports.remove = async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ msg: 'ID no válido' });
        // Removal also works after the organizer makes the board private or deletes it.
        const result = await User.updateOne({ _id: req.user.id }, { $pull: { savedBoards: req.params.id } });
        if (!result.matchedCount) return res.status(401).json({ msg: 'Usuario no disponible' });
        res.json({ saved: false });
    } catch (err) {
        console.error('Error al quitar colección:', err);
        res.status(500).json({ msg: 'Error al quitar colección' });
    }
};
