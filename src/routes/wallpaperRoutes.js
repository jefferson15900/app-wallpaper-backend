const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud } = require('../config/cloudinary');
const wallpaperController = require('../controllers/wallpaperController');

// VARIABLES PARA CACHÉ #HASHTAGS
let trendingTagsCache = [];
let lastTagsUpdate = null;

router.get('/search', wallpaperController.searchWallpapers);
router.get('/discovery', wallpaperController.getDiscoveryFeed);
router.get('/latest', wallpaperController.getLatestWallpapers);
router.post('/upload', [auth, uploadCloud.single('image')], wallpaperController.uploadWallpaper);
router.get('/artist/:artistId', wallpaperController.getArtistWallpapers);
router.get('/my/library', auth, wallpaperController.getUserLibrary);
router.post('/upload', [auth, uploadCloud.single('image')], wallpaperController.uploadWallpaper);
router.get('/:id', wallpaperController.getWallpaperById);
router.put('/download/:id', wallpaperController.registerDownload);
router.put('/like/:id', auth, wallpaperController.toggleLike); 
router.delete('/:id', auth, wallpaperController.deleteWallpaper); 


// --- RUTA: FEED DE SEGUIDOS (Solo para usuarios logueados) ---
router.get('/feed', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user.following || user.following.length === 0) {
            console.log("El usuario no sigue a nadie.");
            return res.json([]); 
        }

        console.log("Buscando wallpapers de los artistas:", user.following);

        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const wallpapers = await Wallpaper.find({ 
            artist: { $in: user.following }, 
            status: 'approved' // <--- ESTO ES LO QUE FILTRA
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

        console.log("Wallpapers encontrados para el feed:", wallpapers.length);
        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error');
    }
});

// ======================================================
// RUTAS DE CONTENIDO DESTACADO (PREMIUM)
// ======================================================

// 1. Obtener Wallpapers marcados como Premium (Para el Carrusel del Home)
router.get('/featured/premium', async (req, res) => {
    try {
        const premiumWalls = await Wallpaper.find({ 
            isPremium: true, 
            status: 'approved' 
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .limit(6); // Limitamos a los 6 mejores para no saturar el carrusel

        res.json(premiumWalls);
    } catch (err) {
        res.status(500).send('Error al obtener contenido premium');
    }
});

// 2. Marcar/Desmarcar como Premium (SOLO ADMIN)
router.put('/admin/set-premium/:id', auth, async (req, res) => {
    try {
        // Verificación de seguridad
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        // Alternar estado: si es true pasa a false, si es false pasa a true
        wallpaper.isPremium = !wallpaper.isPremium;
        await wallpaper.save();

        res.json({ 
            msg: `Estado Premium actualizado`, 
            isPremium: wallpaper.isPremium,
            title: wallpaper.title 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al actualizar estado premium');
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

// 2. Marcar/Desmarcar como Premium (SOLO ADMIN)
router.put('/admin/set-premium/:id', auth, async (req, res) => {
    try {
        // Verificación de seguridad
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        // Alternar estado: si es true pasa a false, si es false pasa a true
        wallpaper.isPremium = !wallpaper.isPremium;
        await wallpaper.save();

        res.json({ 
            msg: `Estado Premium actualizado`, 
            isPremium: wallpaper.isPremium,
            title: wallpaper.title 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al actualizar estado premium');
    }
});

// ======================================================
// 2. RUTAS DE INFORMACIÓN Y PERFILES
// ======================================================

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



// ======================================================
// RUTAS DE CONTENIDO DESTACADO (PREMIUM)
// ======================================================

// 1. Obtener Wallpapers marcados como Premium (Para el Carrusel del Home)
router.get('/featured/premium', async (req, res) => {
    try {
        const premiumWalls = await Wallpaper.find({ 
            isPremium: true, 
            status: 'approved' 
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .limit(6); // Limitamos a los 6 mejores para no saturar el carrusel

        res.json(premiumWalls);
    } catch (err) {
        res.status(500).send('Error al obtener contenido premium');
    }
});


// OBTENER LOS 10 HASHTAGS MÁS USADOS (Con caché de 24h)
router.get('/tags/trending', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        if (trendingTagsCache.length > 0 && lastTagsUpdate === today) {
            return res.json(trendingTagsCache);
        }
     
        const excludedTags = ['espacio', 'autos', 'abstracto', 'otros', 'live', 'general', '', ' '];

        const result = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: "$tags" },
            { 
                $project: { 
                    cleanTag: { $trim: { input: { $toLower: "$tags" } } } 
                } 
            },
            // Filtramos las etiquetas que no queremos y las vacías
            { $match: { cleanTag: { $nin: excludedTags } } },
            // Agrupamos por la etiqueta limpia
            { $group: { _id: "$cleanTag", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 30 }
        ]);

        const tagsOnly = result.map(tag => tag._id);

        trendingTagsCache = tagsOnly;
        lastTagsUpdate = today;

        res.json(tagsOnly);
    } catch (err) {
        res.status(500).send('Error');
    }
});

// --- RUTA: GUARDAR O QUITAR DE FAVORITOS (COLECCIÓN PRIVADA) ---
router.put('/save/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const wallpaperId = req.params.id;
        const isSaved = user.savedWallpapers.some(id => id.toString() === wallpaperId);
        if (isSaved) {
            // Si ya existe, lo quitamos
            user.savedWallpapers = user.savedWallpapers.filter(
                (id) => id.toString() !== wallpaperId
            );
        } else {
            // Si no existe, lo agregamos
            user.savedWallpapers.push(wallpaperId);
        }

        await user.save();
        
        res.json({ 
            msg: isSaved ? 'Quitado' : 'Guardado', 
            isSaved: !isSaved 
        });
    } catch (err) {
        console.error("🔥 Error en /save:", err);
        res.status(500).json({ msg: 'Error de servidor' });
    }
});

module.exports = router;  