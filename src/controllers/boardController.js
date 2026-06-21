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
        const { name, description, isPrivate } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ msg: 'El nombre del tablero es obligatorio' });
        }

        const newBoard = new Board({
            name: name.trim(),
            description: description ? description.trim() : "",
            isPrivate: !!isPrivate,
            user: req.user.id,
            wallpapers: []
        });

        const savedBoard = await newBoard.save();
        res.status(201).json(savedBoard);
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
