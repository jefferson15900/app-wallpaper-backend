const Board = require('../models/Board');
const Wallpaper = require('../models/Wallpaper');
const mongoose = require('mongoose');

// 📂 Obtener tableros del usuario logueado
exports.getUserBoards = async (req, res) => {
    try {
        const boards = await Board.find({ user: req.user.id })
            .populate('wallpapers', 'imageUrl type images')
            .sort({ createdAt: -1 });
        res.json(boards);
    } catch (err) {
        console.error('Error al obtener tableros:', err);
        res.status(500).json({ msg: 'Error al obtener los tableros' });
    }
};

// 📁 Obtener detalles de un tablero específico
exports.getBoardById = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'ID de tablero no válido' });
        }

        const board = await Board.findById(req.params.id)
            .populate({
                path: 'wallpapers',
                select: 'imageUrl title type tags category artist price images',
                populate: { path: 'artist', select: 'username profilePic isVerified' }
            });

        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar si es privado y pertenece al usuario
        if (board.isPrivate && board.user.toString() !== req.user?.id) {
            return res.status(403).json({ msg: 'No tienes acceso a este tablero privado' });
        }

        res.json(board);
    } catch (err) {
        console.error('Error al obtener detalles del tablero:', err);
        res.status(500).json({ msg: 'Error al obtener detalles del tablero' });
    }
};

// 🆕 Crear un nuevo tablero
exports.createBoard = async (req, res) => {
    try {
        const { name, description, isPrivate, wallpaperIds } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ msg: 'El nombre del tablero es obligatorio' });
        }

        // Validar que los wallpaperIds sean objectIds válidos
        const validWallpaperIds = Array.isArray(wallpaperIds)
            ? wallpaperIds.filter(id => mongoose.Types.ObjectId.isValid(id))
            : [];

        const newBoard = new Board({
            name: name.trim(),
            description: description ? description.trim() : "",
            isPrivate: !!isPrivate,
            user: req.user.id,
            wallpapers: validWallpaperIds
        });

        const savedBoard = await newBoard.save();
        const populatedBoard = await Board.findById(savedBoard._id).populate('wallpapers', 'imageUrl type images');
        res.status(201).json(populatedBoard);
    } catch (err) {
        console.error('Error al crear tablero:', err);
        res.status(500).json({ msg: 'Error al crear el tablero' });
    }
};

// ➕ Agregar un wallpaper a un tablero
exports.addWallpaperToBoard = async (req, res) => {
    try {
        const { id, wallpaperId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(wallpaperId)) {
            return res.status(400).json({ msg: 'IDs no válidos' });
        }

        const board = await Board.findById(id);
        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar propiedad
        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        // Verificar si el wallpaper ya está en el tablero
        const exists = board.wallpapers.some(w => w.toString() === wallpaperId);
        if (exists) {
            return res.status(400).json({ msg: 'El fondo ya existe en este tablero' });
        }

        // Verificar si el wallpaper existe
        const wallpaperExists = await Wallpaper.findById(wallpaperId);
        if (!wallpaperExists) {
            return res.status(404).json({ msg: 'El fondo de pantalla no existe' });
        }

        board.wallpapers.unshift(wallpaperId); // Añadir al inicio
        await board.save();

        // Devolvemos el tablero actualizado poblado para refrescar el cliente
        const updatedBoard = await Board.findById(id).populate('wallpapers', 'imageUrl type images');
        res.json(updatedBoard);
    } catch (err) {
        console.error('Error al agregar al tablero:', err);
        res.status(500).json({ msg: 'Error al agregar el fondo al tablero' });
    }
};

// ➕➕ Agregar múltiples wallpapers a un tablero
exports.addMultipleWallpapersToBoard = async (req, res) => {
    try {
        const { id } = req.params;
        const { wallpaperIds } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id) || !Array.isArray(wallpaperIds)) {
            return res.status(400).json({ msg: 'Datos no válidos' });
        }

        const board = await Board.findById(id);
        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar propiedad
        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        // Validar IDs de wallpapers y filtrar duplicados
        const validWallpaperIds = wallpaperIds.filter(wId => mongoose.Types.ObjectId.isValid(wId));
        
        const existingIds = new Set(board.wallpapers.map(w => w.toString()));
        const newIds = validWallpaperIds.filter(wId => !existingIds.has(wId));

        if (newIds.length > 0) {
            // Verificar cuáles de estos wallpapers realmente existen en la base de datos
            const existingWallpapers = await Wallpaper.find({ _id: { $in: newIds } }).select('_id');
            const verifiedIds = existingWallpapers.map(w => w._id.toString());
            
            if (verifiedIds.length > 0) {
                // Añadir al inicio
                board.wallpapers = [...verifiedIds.map(wId => new mongoose.Types.ObjectId(wId)), ...board.wallpapers];
                await board.save();
            }
        }

        const updatedBoard = await Board.findById(id).populate('wallpapers', 'imageUrl type images');
        res.json(updatedBoard);
    } catch (err) {
        console.error('Error al agregar múltiples al tablero:', err);
        res.status(500).json({ msg: 'Error al agregar los fondos al tablero' });
    }
};

// ➖ Eliminar un wallpaper de un tablero
exports.removeWallpaperFromBoard = async (req, res) => {
    try {
        const { id, wallpaperId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(wallpaperId)) {
            return res.status(400).json({ msg: 'IDs no válidos' });
        }

        const board = await Board.findById(id);
        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar propiedad
        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        // Filtrar fuera
        board.wallpapers = board.wallpapers.filter(w => w.toString() !== wallpaperId);
        await board.save();

        const updatedBoard = await Board.findById(id).populate('wallpapers', 'imageUrl type images');
        res.json(updatedBoard);
    } catch (err) {
        console.error('Error al quitar del tablero:', err);
        res.status(500).json({ msg: 'Error al quitar el fondo del tablero' });
    }
};

// ❌ Eliminar tablero por completo
exports.deleteBoard = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'ID de tablero no válido' });
        }

        const board = await Board.findById(req.params.id);
        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar propiedad
        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        await Board.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Tablero eliminado con éxito' });
    } catch (err) {
        console.error('Error al eliminar tablero:', err);
        res.status(500).json({ msg: 'Error al eliminar el tablero' });
    }
};

// ✏️ Actualizar un tablero (nombre, descripción, privacidad)
exports.updateBoard = async (req, res) => {
    try {
        const { name, description, isPrivate } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ msg: 'El nombre del tablero es obligatorio' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'ID de tablero no válido' });
        }

        const board = await Board.findById(req.params.id);
        if (!board) {
            return res.status(404).json({ msg: 'Tablero no encontrado' });
        }

        // Seguridad: Verificar propiedad
        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        board.name = name.trim();
        board.description = description ? description.trim() : "";
        board.isPrivate = !!isPrivate;

        await board.save();
        res.json(board);
    } catch (err) {
        console.error('Error al actualizar tablero:', err);
        res.status(500).json({ msg: 'Error al actualizar el tablero' });
    }
};

// 🔄 Fusionar dos tableros (Fusiona el origen en el destino)
exports.mergeBoards = async (req, res) => {
    try {
        const { targetId, sourceId } = req.params;
        const deleteSource = req.query.deleteSource === 'true';

        if (!mongoose.Types.ObjectId.isValid(targetId) || !mongoose.Types.ObjectId.isValid(sourceId)) {
            return res.status(400).json({ msg: 'IDs de tablero no válidos' });
        }

        if (targetId === sourceId) {
            return res.status(400).json({ msg: 'No se puede fusionar un tablero consigo mismo' });
        }

        // Obtener ambos tableros
        const sourceBoard = await Board.findById(sourceId);
        const targetBoard = await Board.findById(targetId);

        if (!sourceBoard || !targetBoard) {
            return res.status(404).json({ msg: 'Uno o ambos tableros no fueron encontrados' });
        }

        // Seguridad: Verificar propiedad de ambos tableros
        if (sourceBoard.user.toString() !== req.user.id || targetBoard.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        // Combinar wallpapers evitando duplicados
        const sourceWallpapers = sourceBoard.wallpapers.map(w => w.toString());
        const targetWallpapers = targetBoard.wallpapers.map(w => w.toString());

        // Unir arrays y mantener orden (antiguos del target y luego agregamos los del source)
        const combinedSet = new Set([...targetWallpapers, ...sourceWallpapers]);
        targetBoard.wallpapers = Array.from(combinedSet).map(id => new mongoose.Types.ObjectId(id));

        await targetBoard.save();

        if (deleteSource) {
            await Board.findByIdAndDelete(sourceId);
        }

        // Devolver la lista completa y actualizada de tableros del usuario
        const boards = await Board.find({ user: req.user.id })
            .populate('wallpapers', 'imageUrl type images')
            .sort({ createdAt: -1 });

        res.json({
            msg: 'Tableros fusionados con éxito',
            boards,
            targetBoardId: targetId
        });
    } catch (err) {
        console.error('Error al fusionar tableros:', err);
        res.status(500).json({ msg: 'Error al fusionar los tableros' });
    }
};

