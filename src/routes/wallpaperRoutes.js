const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud, cloudinary } = require('../config/cloudinary');
const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');
const { getAITags } = require('../services/aiService');

let expo = new Expo();

// VARIABLES PARA CACHÉ #HASHTAGS
let trendingTagsCache = [];
let lastTagsUpdate = null;


// --- RUTA: FEED DE SEGUIDOS (Solo para usuarios logueados) ---
// RUTA: FEED DE SEGUIDOS (Actualizada con logs)
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

// Obtener UN SOLO wallpaper por ID
router.get('/:id', async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id)
            .populate('artist', 'username profilePic isVerified instagram twitter tiktok facebook');
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });
        res.json(wallpaper);
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

// Obtener todos los wallpapers aprobados (Público)
router.get('/', async (req, res) => {
    try {
        const { search, category } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // --- CASO 1: NAVEGACIÓN NORMAL (Sin búsqueda) ---
        if (!search || search.trim() === '') {
            let query = { status: 'approved' };
            if (category && category !== 'Todos') query.category = category;
            
            const walls = await Wallpaper.find(query)
                .populate('artist', 'username profilePic isVerified')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            return res.json(walls);
        }

        // --- CASO 2: BÚSQUEDA PROFESIONAL (Atlas Search) ---
        const pipeline = [
            {
                $search: {
                    index: "default", // El nombre que pusiste en la web de MongoDB
                    text: {
                        query: search,
                        path: ["title", "tags"], // Busca en título y etiquetas
                        fuzzy: { 
                            maxEdits: 1, // Permite 1 error de letra (Ej: "Goku" -> "Guko")
                        }
                    }
                }
            },
            { $match: { status: 'approved' } }, // Filtramos solo aprobados
            { $skip: skip },
            { $limit: limit },
            {
                // Unimos con la tabla de usuarios para traer los datos del artista (es el populate manual)
                $lookup: {
                    from: 'users',
                    localField: 'artist',
                    foreignField: '_id',
                    as: 'artist'
                }
            },
            { $unwind: '$artist' } // Convertimos el array de artista en un objeto
        ];

        // Si el usuario eligió una categoría, la filtramos dentro de la búsqueda
        if (category && category !== 'Todos') {
            pipeline.splice(1, 0, { $match: { category: category } });
        }

        const results = await Wallpaper.aggregate(pipeline);
        res.json(results);

    } catch (err) {
        console.error("Error en motor de búsqueda:", err);
        res.status(500).send('Error en el servidor');
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
// RUTA: SUBIR WALLPAPER (Con IA de etiquetas y contador automático)
router.post('/upload', [auth, uploadCloud.single('image')], async (req, res) => {
    try {
        // 1. Validación de seguridad inicial
        if (!req.file) {
            return res.status(400).json({ msg: 'No se recibió ninguna imagen' });
        }

        const { title, category } = req.body;

        // 2. Procesar etiquetas básicas (Filtro de seguridad)
        let baseTags = title 
            ? title.split(',').map(tag => tag.trim().toLowerCase()).filter(t => t !== "") 
            : [];
        
        if (category) {
            baseTags.push(category.toLowerCase());
        }

        const newWallpaper = new Wallpaper({
            title: title || `Art by ${req.user.id.substring(0,5)}`,
            tags: baseTags,
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: category || 'Otros',
            artist: req.user.id,
            status: 'pending',
            isAITagged: false // Se marcará como true cuando la IA termine
        });

        await newWallpaper.save();
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: 1 } });

        // 5. RESPUESTA INSTANTÁNEA AL FRONTEND (UX Rápida)
        res.json(newWallpaper);

        // 6. PROCESO EN SEGUNDO PLANO (Cerebro de IA Gemini)
        (async () => {
            try {
                console.log(`🤖 Iniciando análisis de IA para: ${newWallpaper.title}`);
                
                // Llamamos al servicio de IA que creamos en aiService.js
                const aiTags = await getAITags(req.file.path);
                
                if (aiTags && aiTags.length > 0) {

                    const finalTags = [...new Set([...baseTags, ...aiTags])];
                    await Wallpaper.findByIdAndUpdate(newWallpaper._id, { 
                        $set: { 
                            tags: finalTags, 
                            isAITagged: true 
                        } 
                    });
                    
                    console.log(`✅ IA enriqueció con éxito el arte ID: ${newWallpaper._id}`);
                }
            } catch (aiError) {

                console.error("⚠️ La IA de Google falló, pero el wallpaper se mantuvo a salvo.");
            }
        })();

    } catch (err) {
        console.error("❌ Error crítico en la ruta de subida:", err);
        res.status(500).json({ msg: 'Error interno al procesar la subida' });
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
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: -1 } });

        if (wallpaper.public_id) await cloudinary.uploader.destroy(wallpaper.public_id);
        await Wallpaper.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Eliminado correctamente' });
    } catch (err) {
        res.status(500).send('Error al eliminar');
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


// OBTENER LOS 10 HASHTAGS MÁS USADOS (Con caché de 24h)
router.get('/tags/trending', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Si el caché es de hoy, respondemos de inmediato sin tocar la base de datos
        if (trendingTagsCache.length > 0 && lastTagsUpdate === today) {
            return res.json(trendingTagsCache);
        }

        // 2. Si es un día nuevo, hacemos el cálculo pesado una sola vez
        console.log("📊 Calculando nuevas tendencias de hashtags...");
        const result = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: "$tags" },
            { $group: { _id: "$tags", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        const tagsOnly = result.map(tag => tag._id);

        // 3. Guardamos en el caché
        trendingTagsCache = tagsOnly;
        lastTagsUpdate = today;

        res.json(tagsOnly);
    } catch (err) {
        console.error("Error en tags:", err);
        res.status(500).send('Error');
    }
});

module.exports = router;