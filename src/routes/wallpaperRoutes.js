const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud, cloudinary } = require('../config/cloudinary');
const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User'); // <--- FALTA ESTA IMPORTACIÓN

// ======================================================
// 1. RUTAS DE ADMINISTRADOR (GM) - VAN AL PRINCIPIO
// ======================================================

// Obtener wallpapers pendientes de aprobación
router.get('/admin/pending', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado. No eres admin.' });

        const pending = await Wallpaper.find({ status: 'pending' })
            .populate('artist', 'username email');
        res.json(pending);
    } catch (err) {
        res.status(500).send('Error en el servidor al buscar pendientes');
    }
});

// Aprobar o Rechazar un wallpaper
router.put('/admin/decide/:id', auth, async (req, res) => {
    const { action } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'No autorizado' });

        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        if (action === 'rejected') {
            // Limpieza de Cloudinary
            if (wallpaper.public_id) await cloudinary.uploader.destroy(wallpaper.public_id);
            // Limpieza de Base de Datos
            await Wallpaper.findByIdAndDelete(req.params.id);
            return res.json({ msg: 'Rechazado y borrado de la nube' });
        }

        // Si es aprobado
        wallpaper.status = 'approved';
        await wallpaper.save();
        res.json({ msg: 'Aprobado y publicado' });
    } catch (err) {
        res.status(500).send('Error al procesar decisión');
    }
});

// ======================================================
// 2. RUTAS DE INFORMACIÓN Y PERFILES
// ======================================================

// Obtener todos los wallpapers aprobados (Público)
router.get('/', async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = { status: 'approved' }; 

        if (search) query.title = { $regex: search, $options: 'i' };
        if (category && category !== 'Todos') query.category = category;

        const wallpapers = await Wallpaper.find(query)
            .populate('artist', 'username profilePic instagram twitter tiktok facebook')
            .sort({ createdAt: -1 });
        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error al obtener wallpapers');
    }
});

// Obtener wallpapers de un artista específico
router.get('/artist/:artistId', async (req, res) => {
    try {
        const wallpapers = await Wallpaper.find({ artist: req.params.artistId }).sort({ createdAt: -1 });
        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error al obtener galería del artista');
    }
});

// Obtener información pública de un usuario/artista
router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -email'); 
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).send('Error al obtener datos del usuario');
    }
});

// ======================================================
// 3. ACCIONES DE USUARIO (SUBIR, LIKE, DOWNLOAD, DELETE)
// ======================================================

// Subir Wallpaper (Entra como pendiente)
router.post('/upload', [auth, uploadCloud.single('image')], async (req, res) => {
    try {
        const newWallpaper = new Wallpaper({
            title: req.body.title || "Sin título",
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: req.body.category || 'Global',
            artist: req.user.id,
            status: 'pending' // Siempre pendiente al inicio
        });
        const savedWallpaper = await newWallpaper.save();
        res.json(savedWallpaper);
    } catch (err) {
        res.status(500).send('Error al subir imagen');
    }
});

// Dar o quitar Like
router.put('/like/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        if (wallpaper.likes.includes(req.user.id)) {
            wallpaper.likes = wallpaper.likes.filter(id => id.toString() !== req.user.id);
        } else {
            wallpaper.likes.push(req.user.id);
        }

        await wallpaper.save();
        res.json(wallpaper.likes);
    } catch (err) {
        res.status(500).send('Error en el Like');
    }
});

// Contador de Descarga
router.put('/download/:id', async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).send();
        wallpaper.downloads += 1;
        await wallpaper.save();
        res.json({ downloads: wallpaper.downloads });
    } catch (err) {
        res.status(500).send('Error');
    }
});

// Eliminar Wallpaper (Solo el dueño)
router.delete('/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        if (wallpaper.artist.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'No autorizado' });
        }

        if (wallpaper.public_id) await cloudinary.uploader.destroy(wallpaper.public_id);
        await Wallpaper.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Eliminado correctamente' });
    } catch (err) {
        res.status(500).send('Error al eliminar');
    }
});

module.exports = router;