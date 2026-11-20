const mongoose = require('mongoose');
const Board = require('../models/Board');
const User = require('../models/User');

const organizerFields = '_id username profilePic isVerified';
const eligibleOrganizer = { isActive: { $ne: false }, $or: [{ isVerified: true }, { role: 'admin' }] };

exports.list = async (req, res) => {
    try {
        const { organizerId, cursor } = req.query;
        if ((organizerId && !mongoose.isObjectIdOrHexString(organizerId)) ||
            (cursor && !mongoose.isObjectIdOrHexString(cursor))) {
            return res.status(400).json({ msg: 'Consulta de colecciones no válida' });
        }
        const organizers = await User.find({ ...eligibleOrganizer, ...(organizerId ? { _id: organizerId } : {}) })
            .select(organizerFields).lean();
        if (organizerId && !organizers.length) return res.status(404).json({ msg: 'Organizador no encontrado' });
        const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        const match = { isPrivate: false, user: { $in: organizers.map(user => user._id) } };
        if (cursor) match._id = { $lt: new mongoose.Types.ObjectId(cursor) };
        if (query) match.name = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        // Only approved, existing wallpapers count or appear in public previews.
        const items = await Board.aggregate([
            { $match: match }, { $sort: { _id: -1 } },
            { $lookup: { from: 'wallpapers', let: { ids: '$wallpapers' }, pipeline: [
                { $match: { status: 'approved', $expr: { $in: ['$_id', '$$ids'] } } },
                { $sort: { _id: -1 } },
                { $project: { imageUrl: 1, type: 1 } },
            ], as: 'visibleWallpapers' } },
            { $match: { 'visibleWallpapers.0': { $exists: true } } },
            { $limit: 13 },
            { $project: { name: 1, description: 1, wallpaperCount: { $size: '$visibleWallpapers' },
                previews: { $slice: ['$visibleWallpapers', 3] } } },
        ]);
        const hasMore = items.length > 12;
        const page = items.slice(0, 12);
        res.json({ items: page, nextCursor: hasMore ? page[page.length - 1]._id.toString() : null,
            ...(organizerId ? { organizer: organizers[0] } : {}) });
    } catch (err) {
        console.error('Error al listar colecciones:', err);
        res.status(500).json({ msg: 'Error al cargar colecciones' });
    }
};

exports.detail = async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ msg: 'ID no válido' });
        const board = await Board.findOne({ _id: req.params.id, isPrivate: false })
            .select('name description user isPrivate wallpapers')
            .populate({ path: 'wallpapers', match: { status: 'approved' },
                select: 'imageUrl type tags price isPremium images.imageUrl images.assetId images.public_id' }).lean();
        const organizer = board && await User.findOne({ ...eligibleOrganizer, _id: board.user })
            .select(organizerFields).lean();
        if (!board || !organizer) return res.status(404).json({ msg: 'Colección no disponible' });
        res.json({ ...board, organizer });
    } catch (err) {
        console.error('Error al abrir colección:', err);
        res.status(500).json({ msg: 'Error al cargar colección' });
    }
};
