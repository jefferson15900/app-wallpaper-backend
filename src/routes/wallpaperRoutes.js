const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud } = require('../config/cloudinary');
const Wallpaper = require('../models/Wallpaper');
const { cloudinary } = require('../config/cloudinary');

// OBTENER WALLPAPERS (CON FILTROS)
router.get('/', async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = { status: 'approved' }; // <--- FILTRO DE SEGURIDAD

        if (search) query.title = { $regex: search, $options: 'i' };
        if (category && category !== 'Todos') query.category = category;

        const wallpapers = await Wallpaper.find(query)
            .populate('artist', 'username profilePic')
            .sort({ createdAt: -1 });
        res.json(wallpapers);
    } catch (err) { res.status(500).send('Error'); }
});

// SUBIR WALLPAPER
router.post('/upload', [auth, uploadCloud.single('image')], async (req, res) => {
    try {
        const newWallpaper = new Wallpaper({
            title: req.body.title || "Sin título",
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: req.body.category || 'General', // Guardamos la categoría enviada
            artist: req.user.id
        });
        const savedWallpaper = await newWallpaper.save();
        res.json(savedWallpaper);
    } catch (err) {
        res.status(500).send('Error al subir imagen');
    }
});

// DAR O QUITAR LIKE
router.put('/like/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        // Si ya tiene like del usuario, lo quitamos. Si no, lo ponemos.
        if (wallpaper.likes.includes(req.user.id)) {
            wallpaper.likes = wallpaper.likes.filter(id => id.toString() !== req.user.id);
        } else {
            wallpaper.likes.push(req.user.id);
        }

        await wallpaper.save();
        res.json(wallpaper.likes); // Devolvemos la lista actualizada de IDs
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

// CONTAR DESCARGA
router.put('/download/:id', async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        wallpaper.downloads += 1;
        await wallpaper.save();
        res.json({ downloads: wallpaper.downloads });
    } catch (err) {
        res.status(500).send('Error');
    }
});


// Obtener wallpapers de un artista específico
router.get('/artist/:artistId', async (req, res) => {
    try {
        const wallpapers = await Wallpaper.find({ artist: req.params.artistId }).sort({ createdAt: -1 });
        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error al obtener perfil');
    }
});


// ELIMINAR WALLPAPER (Solo el dueño puede hacerlo)
router.delete('/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);

        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // Verificar que el que intenta borrar sea el dueño
        if (wallpaper.artist.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'No autorizado para borrar esta obra' });
        }

        // 1. Borrar de Cloudinary usando el public_id
        await cloudinary.uploader.destroy(wallpaper.public_id);

        // 2. Borrar de MongoDB
        await Wallpaper.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Wallpaper eliminado correctamente' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al eliminar');
    }
});

// Obtener información pública de un usuario/artista
router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password'); // Excluimos la contraseña
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).send('Error al obtener usuario');
    }
});


// OBTENER PENDIENTES (SOLO ADMIN/GM)
router.get('/admin/pending', auth, async (req, res) => {
    try {
        // Buscamos específicamente los que tienen status 'pending'
        const pending = await Wallpaper.find({ status: 'pending' })
            .populate('artist', 'username email');
        
        console.log("Wallpapers pendientes encontrados:", pending.length);
        res.json(pending);
    } catch (err) {
        res.status(500).send('Error al obtener pendientes');
    }
});
// APROBAR O RECHAZAR (SOLO ADMIN/GM)
router.put('/admin/decide/:id', auth, async (req, res) => {
    try {
        const { action } = req.body; // 'approved' o 'rejected'
        const wallpaper = await Wallpaper.findById(req.params.id);

        if (action === 'rejected') {
            await cloudinary.uploader.destroy(wallpaper.public_id); // Borramos de la nube
            await Wallpaper.findByIdAndDelete(req.params.id); // Borramos de la DB
            return res.json({ msg: 'Wallpaper rechazado y eliminado' });
        }

        wallpaper.status = 'approved';
        await wallpaper.save();
        res.json({ msg: 'Wallpaper aprobado y publicado' });
    } catch (err) { res.status(500).send('Error'); }
});

module.exports = router;