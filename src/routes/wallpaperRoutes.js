const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud, cloudinary } = require('../config/cloudinary');
const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');


let expo = new Expo();

// Obtener UN SOLO wallpaper por ID
router.get('/:id', async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id)
            .populate('artist', 'username profilePic instagram twitter tiktok facebook');
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });
        res.json(wallpaper);
    } catch (err) {
        res.status(500).send('Error');
    }
});

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


// APROBAR O RECHAZAR WALLPAPER (SOLO ADMIN/GM)
router.put('/admin/decide/:id', auth, async (req, res) => {
    const { action } = req.body; // Recibe 'approved' o 'rejected'
    
    try {
        // 1. Verificación de seguridad de Administrador
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'No autorizado' });

        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // --- CASO A: RECHAZADO ---
        if (action === 'rejected') {
            // Limpieza de Cloudinary (liberar espacio)
            if (wallpaper.public_id) {
                await cloudinary.uploader.destroy(wallpaper.public_id);
            }
            // Borrado definitivo de la base de datos
            await Wallpaper.findByIdAndDelete(req.params.id);
            
            return res.json({ msg: 'Wallpaper rechazado y borrado de la nube con éxito' });
        }

        // --- CASO B: APROBADO ---
        wallpaper.status = 'approved';
        await wallpaper.save();

        // --- LÓGICA DE NOTIFICACIONES ---
        // Buscamos al artista y traemos los tokens de sus seguidores
        const artist = await User.findById(wallpaper.artist).populate('followers', 'pushToken');
        let messages = [];

        // 1. Notificación para el Artista (Confirmación de éxito)
        if (artist.pushToken && Expo.isExpoPushToken(artist.pushToken)) {
            messages.push({
                to: artist.pushToken,
                sound: 'default',
                title: '¡Obra Publicada! 🎨',
                body: `Tu wallpaper "${wallpaper.title}" ya es público en la galería.`,
                data: { screen: 'Profile' },
            });
        }

        // 2. Notificación para Seguidores (Con tiempo de espera de 10 minutos)
        const DIEZ_MINUTOS = 10 * 60 * 1000;
        const ahora = new Date();
        const ultimaVez = artist.lastNotificationSentAt ? new Date(artist.lastNotificationSentAt) : null;

        // Solo preparamos mensajes para fans si pasó el tiempo suficiente o es la primera vez
        if (!ultimaVez || (ahora - ultimaVez) > DIEZ_MINUTOS) {
            for (let follower of artist.followers) {
                if (follower.pushToken && Expo.isExpoPushToken(follower.pushToken)) {
                    messages.push({
                        to: follower.pushToken,
                        sound: 'default',
                        title: '¡Nuevo arte disponible! ✨',
                        body: `${artist.username} acaba de subir un nuevo wallpaper. ¡Échale un ojo!`,
                        data: { artistId: artist._id },
                    });
                }
            }
            // Actualizamos la fecha en el artista para activar el silencio de 10 min
            artist.lastNotificationSentAt = ahora;
            await artist.save();
        }

        // 3. Envío masivo en lotes (Chunks)
        if (messages.length > 0) {
            let chunks = expo.chunkPushNotifications(messages);
            (async () => {
                for (let chunk of chunks) {
                    try {
                        await expo.sendPushNotificationsAsync(chunk);
                    } catch (error) {
                        console.error("Error enviando notificación:", error);
                    }
                }
            })();
        }

        res.json({ msg: 'Wallpaper aprobado y comunidad notificada' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error al procesar la decisión del administrador');
    }
});

// ======================================================
// 2. RUTAS DE INFORMACIÓN Y PERFILES
// ======================================================

// Obtener todos los wallpapers aprobados (Público)
router.get('/', async (req, res) => {
    try {
        const { search, category } = req.query;
        
        // Lógica de Paginación
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        let query = { status: 'approved' }; 

        // --- BÚSQUEDA INTELIGENTE (Título o Tags) ---
        if (search && search.trim() !== '') {
            query.$or = [
                { title: { $regex: search, $options: 'i' } }, // Busca en el título
                { tags: { $regex: search, $options: 'i' } }   // Busca dentro del array de etiquetas
            ];
        }
        
        if (category && category !== 'Todos') query.category = category;

        const wallpapers = await Wallpaper.find(query)
            .populate('artist', 'username profilePic instagram twitter tiktok facebook')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error al obtener wallpapers');
    }
});

// Obtener wallpapers de un artista específico
router.get('/artist/:artistId', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;

        // 1. Contamos cuántos hay en TOTAL en la base de datos
        const totalCount = await Wallpaper.countDocuments({ artist: req.params.artistId });

        // 2. Buscamos solo los de la página actual
        const wallpapers = await Wallpaper.find({ artist: req.params.artistId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // 3. Enviamos ambos datos
        res.json({ wallpapers, totalCount }); 
    } catch (err) {
        res.status(500).send('Error al obtener perfil');
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
        const { title, category } = req.body;
        
        // Convertimos "anime, girl, 4k" en ["anime", "girl", "4k"]
        const tagArray = title.split(',').map(tag => tag.trim().toLowerCase());

        const newWallpaper = new Wallpaper({
            title: title, // Guardamos el texto original
            tags: tagArray, // Guardamos la lista para búsquedas rápidas
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: category,
            artist: req.user.id,
            status: 'pending'
        });
        await newWallpaper.save();
        res.json(newWallpaper);
    } catch (err) { res.status(500).send('Error'); }
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

// OBTENER FEED DE SEGUIDOS (PRIVADO)
router.get('/feed', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // Buscamos wallpapers donde el artista esté en mi lista de 'following'
        const wallpapers = await Wallpaper.find({ 
            artist: { $in: user.following }, 
            status: 'approved' 
        })
        .populate('artist', 'username profilePic')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

        res.json(wallpapers);
    } catch (err) { res.status(500).send('Error'); }
})

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