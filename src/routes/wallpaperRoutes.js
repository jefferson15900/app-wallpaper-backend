const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud, cloudinary } = require('../config/cloudinary');
const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');
const { getAITags } = require('../services/aiService');
const aiQueue = require('../services/aiQueue'); 
const Visitor = require('../models/Visitor');
const mongoose = require('mongoose'); 

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
// RUTA PRINCIPAL: BUSQUEDA, EXPLORACIÓN (CRONOLÓGICA) Y DESCUBRIMIENTO (ALEATORIA)
router.get('/', async (req, res) => {
    try {
        // 1. Extraemos todos los filtros, incluyendo el nuevo artistId
        const { search, category, limit = 10, page = 1, random, type, artistId, premium  } = req.query; 
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const parsedLimit = parseInt(limit);

        // --- 1. FILTRO BASE: Siempre aprobados ---
        let matchQuery = { status: 'approved' };
        if (category && category !== 'Todos') matchQuery.category = category;
        if (type && type !== 'all') matchQuery.type = type;
        if (premium === 'true') {
              matchQuery.price = { $gt: 0 }; // Busca donde el precio sea mayor a 0
            }

        // --- ⚡ LA CORRECCIÓN PARA EL PERFIL ---
        if (artistId) {
            // Convertimos el ID de texto a un ID de MongoDB real
            try {
                matchQuery.artist = new mongoose.Types.ObjectId(artistId);
            } catch (e) {
                return res.status(400).json({ msg: 'ID de artista inválido' });
            }
        }


     
// ─────────────────────────────────────────────────────────────────
// FIX: Búsqueda por tag desde SearchScreen (vitrinas ADN)
// El problema: fuzzy con maxEdits:1 en palabras cortas como "car"
// coincide con "dark", "scar", "care", "cartoon", etc.
// ─────────────────────────────────────────────────────────────────

if (search && search.trim() !== '') {
    const { exclude } = req.query;
    const parsedLimit = parseInt(req.query.limit) || 16;
    const searchTerm = search.trim();

    let excludeIds = [];
    if (exclude && exclude !== '') {
        excludeIds = exclude.split(',')
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .slice(0, 50)
            .map(id => new mongoose.Types.ObjectId(id));
    }

    // 🔑 FIX: fuzzy solo para palabras LARGAS (más de 4 caracteres)
    const useFuzzy = searchTerm.length > 4;

    let pipeline = [
        {
            $search: {
                index: "default",
                text: {
                    query: searchTerm,
                    path: ["title", "tags"],
                    // Solo aplicamos fuzzy en palabras largas
                    ...(useFuzzy ? { fuzzy: { maxEdits: 1, prefixLength: 2 } } : {})
                }
            }
        }
    ];

    let finalMatch = { ...matchQuery };
    if (excludeIds.length > 0) {
        finalMatch._id = { $nin: excludeIds };
    }
    pipeline.push({ $match: finalMatch });

    if (req.query.random === 'true') {
        pipeline.push({ $sample: { size: parsedLimit } });
    } else {
        pipeline.push({ $skip: skip }, { $limit: parsedLimit });
    }

    pipeline.push(
        { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
        { $unwind: { path: '$artist', preserveNullAndEmptyArrays: true } },
        { $project: { 'artist.password': 0, 'artist.email': 0, 'artist.pushToken': 0 } }
    );

    const searchResults = await Wallpaper.aggregate(pipeline);

    const sanitizedResults = searchResults.map(item => ({
        ...item,
        price: item.price ?? 0
    }));

    return res.json(sanitizedResults);
}


// ─────────────────────────────────────────────────────────────────
// CASO 2: FEED "PARA TI" — 100% TAGS, sin categorías
// ─────────────────────────────────────────────────────────────────

if (random === 'true') {
    const { tags, exclude, category, type, artistId, premium } = req.query;
    const parsedLimit = parseInt(req.query.limit) || 16;

    // ── 1. FILTRO BASE ──────────────────────────────────────────
    let baseMatch = { status: 'approved' };
    if (category && category !== 'Todos') baseMatch.category = category;
    if (type && type !== 'all') baseMatch.type = type;
    if (premium === 'true') baseMatch.price = { $gt: 0 };
    if (artistId && mongoose.Types.ObjectId.isValid(artistId)) {
        baseMatch.artist = new mongoose.Types.ObjectId(artistId);
    }

    if (exclude && exclude !== '') {
        const excludeIds = exclude.split(',')
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .slice(0, 50)
            .map(id => new mongoose.Types.ObjectId(id));
        if (excludeIds.length > 0) baseMatch._id = { $nin: excludeIds };
    }

    // ── 2. ADN DEL USUARIO (solo tags) ─────────────────────────
    const userTags = tags
        ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];

    let pipeline = [];

    if (userTags.length > 0) {
        // ── RANKING POR AFINIDAD ────────────────────────────────
        // Score = cuántos tags del wallpaper coinciden con el ADN
        // Garantiza que los carros salgan primero si le gustan al usuario
        pipeline.push(
            { $match: baseMatch },
            {
                $addFields: {
                    affinityScore: {
                        $size: {
                            $ifNull: [{
                                $filter: {
                                    input: { $ifNull: ['$tags', []] },
                                    as: 'tag',
                                    cond: { $in: ['$$tag', userTags] }
                                }
                            }, []]
                        }
                    }
                }
            },
            // Grupo: 0=alta afinidad(3+), 1=media(1-2), 2=descubrimiento(0)
            {
                $addFields: {
                    affinityGroup: {
                        $switch: {
                            branches: [
                                { case: { $gte: ['$affinityScore', 3] }, then: 0 },
                                { case: { $gte: ['$affinityScore', 1] }, then: 1 },
                            ],
                            default: 2
                        }
                    }
                }
            },
            
            // Ordenar: alta afinidad primero, dentro de cada grupo un poco aleatorio
             { $sort: { affinityGroup: 1, affinityScore: -1 } },
             { $limit: parsedLimit * 3 }, // traemos 3x más candidatos
             { $sample: { size: parsedLimit } }
        );

    } else {
        // Usuario nuevo sin ADN → random puro
        pipeline.push(
            { $match: baseMatch },
            { $sample: { size: parsedLimit } }
        );
    }

    // ── 3. JOIN CON ARTISTA ──────────────────────────────────────
    pipeline.push(
        { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
        { $unwind: { path: '$artist', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                'artist.password': 0,
                'artist.email': 0,
                'artist.pushToken': 0,
                'artist.lastActiveAt': 0,
                'affinityScore': 0,
                'affinityGroup': 0
            }
        }
    );

    const results = await Wallpaper.aggregate(pipeline);
    return res.json(results.map(item => ({ ...item, price: item.price ?? 0 })));
 }


        // --- 🔵 CASO 3: NAVEGACIÓN NORMAL (Cronológica / Perfil de Artista) ---
        const walls = await Wallpaper.find(matchQuery)
            .populate('artist', 'username profilePic isVerified')
            .sort({ createdAt: -1 }) 
            .skip(skip)
            .limit(parsedLimit)
            

        res.json(walls);

    } catch (err) {
        console.error("❌ Error crítico en ruta principal:", err);
        res.status(500).json({ msg: 'Error interno del servidor' });
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

        // 2. Buscamos los wallpapers e INCLUIMOS los datos del artista (FOTO, NOMBRE, ETC)
        const wallpapers = await Wallpaper.find({ artist: req.params.artistId })
            .populate('artist', 'username profilePic isVerified') // 👈 SOLUCIÓN: Esto trae la foto para el icono
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // 3. Enviamos ambos datos
        res.json({ wallpapers, totalCount }); 
    } catch (err) {
        console.error("Error al obtener perfil del artista:", err);
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

// RUTA: SUBIR WALLPAPER (Optimizada con Cola de IA Segura)
router.post('/upload', [auth, uploadCloud.single('image')], async (req, res) => {

    
    try {
        // 1. Validación de seguridad inicial: ¿Llegó el archivo?
        if (!req.file) {
            return res.status(400).json({ msg: 'No se recibió ninguna imagen o video' });
        }

        // Detección de tipo de archivo
        const isVideo = req.file.mimetype.startsWith('video');
        
        // SEGURIDAD: Solo el Administrador puede subir videos
        const user = await User.findById(req.user.id);
        if (isVideo && (!user || user.role !== 'admin')) {
            // Borrado preventivo en Cloudinary si un usuario normal intenta subir video
            await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'video' });
            return res.status(403).json({ msg: 'Acceso denegado: Solo el administrador puede subir Live Wallpapers' });
        }
console.log("📦 Datos recibidos en el servidor:", req.body); 
        const { title, category , price} = req.body;

        // 2. Procesar etiquetas básicas del usuario
        let baseTags = title 
            ? title.split(',').map(tag => tag.trim().toLowerCase()).filter(t => t !== "") 
            : [];
        
        if (category) {
            baseTags.push(category.toLowerCase());
        }

        // 3. Crear el registro en MongoDB
        const newWallpaper = new Wallpaper({
            title: title || `Art by ${user.username || req.user.id.substring(0,5)}`,
            tags: baseTags,
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: category || 'Otros',
            artist: req.user.id,
            type: isVideo ? 'video' : 'image',
            status: isVideo ? 'approved' : 'pending', // Videos de admin se aprueban automáticamente
            isAITagged: false, 
            price: user.role === 'admin' ? parseInt(price || 0) : 0
        });

        // 4. Guardar en DB y aumentar el contador del artista
        await newWallpaper.save();
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: 1 } });

        // 5. RESPUESTA INSTANTÁNEA AL FRONTEND
        res.json(newWallpaper);

        // 6. ENVIAR A LA COLA DE PROCESAMIENTO IA (SOLO SI ES IMAGEN)
        if (!isVideo) {
            aiQueue.addJob({
                wallpaperId: newWallpaper._id,
                imageUrl: req.file.path,
                baseTags: baseTags
            });
        }

    } catch (err) {
                // --- LOG DE ERROR MEJORADO ---
        console.error("❌ ERROR CRÍTICO EN UPLOAD:");
        console.error("Mensaje:", err.message);
        console.error("Stack:", err.stack);

        // Si Cloudinary dio error por tamaño o formato
        if (err.http_code) {
             return res.status(err.http_code).json({ msg: 'Error en la nube: ' + err.message });
        }
        console.error("❌ Error crítico en la ruta de subida:", err);
        res.status(500).json({ msg: 'Error interno al procesar la subida' });
    }
});

// Dar o quitar Like
router.put('/like/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        const userId = req.user.id;
        const wallpaperId = req.params.id;

        // Verificar si ya tiene like
        const alreadyLiked = wallpaper.likes.includes(userId);

        if (alreadyLiked) {
            // Quitar Like de ambos modelos
            wallpaper.likes = wallpaper.likes.filter(id => id.toString() !== userId);
            await User.findByIdAndUpdate(userId, { $pull: { likedWallpapers: wallpaperId } });
        } else {
            // Poner Like en ambos modelos
            wallpaper.likes.push(userId);
            await User.findByIdAndUpdate(userId, { $addToSet: { likedWallpapers: wallpaperId } });
        }

        await wallpaper.save();

        // ✅ RESPUESTA SIEMPRE EN JSON
        res.json({ 
            likesCount: wallpaper.likes.length, 
            isLiked: !alreadyLiked 
        });

    } catch (err) {
        console.error("❌ Error en Like:", err);
        res.status(500).json({ msg: 'Error interno del servidor' });
    }
});

// RUTA: REGISTRAR DESCARGA Y RASTREAR RETENCIÓN
router.put('/download/:id', async (req, res) => {
    try {
        // 1. Incrementar el contador de descargas del wallpaper de forma atómica
        const wallpaper = await Wallpaper.findByIdAndUpdate(
            req.params.id,
            { $inc: { downloads: 1 } },
            { new: true }
        );

        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // 2. LÓGICA DE RASTREO PARA ANALYTICS (RETENCIÓN)
        const token = req.header('x-auth-token');
        const deviceId = req.header('x-device-id'); // ID único del hardware enviado desde el frontend

        // CASO A: Si el usuario está logueado, actualizamos su perfil
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                await User.findByIdAndUpdate(decoded.user.id, { 
                    $set: { lastDownloadAt: new Date(), lastActiveAt: new Date() } 
                });
            } catch (e) {
                // Token expirado o inválido: ignoramos el error para no bloquear la descarga
            }
        }

        // CASO B: Rastrear por dispositivo (Para medir usuarios invitados y registrados por igual)
        if (deviceId) {
            await Visitor.findOneAndUpdate(
                { deviceId },
                { 
                    $set: { lastDownloadAt: new Date(), lastActiveAt: new Date() },
                    $setOnInsert: { createdAt: new Date() } 
                },
                { upsert: true } // Si no existe el dispositivo en la DB, lo crea
            );
        }

        res.json({ downloads: wallpaper.downloads });

    } catch (err) {
        console.error("❌ Error en ruta de descarga:", err);
        res.status(500).send('Error interno del servidor');
    }
});

// Eliminar Wallpaper (Solo el dueño)
// Eliminar Wallpaper (Dueño) con limpieza total de Cloudinary
router.delete('/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        if (wallpaper.artist.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'No autorizado' });
        }

        // 1. Borrar de Cloudinary especificando el tipo de recurso
        if (wallpaper.public_id) {
            await cloudinary.uploader.destroy(wallpaper.public_id, {
                resource_type: wallpaper.type === 'video' ? 'video' : 'image'
            });
        }

        // 2. Actualizar contador del artista y borrar de DB
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: -1 } });
        await Wallpaper.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Eliminado correctamente' });
    } catch (err) {
        console.error(err);
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

        if (trendingTagsCache.length > 0 && lastTagsUpdate === today) {
            return res.json(trendingTagsCache);
        }
     
        const excludedTags = ['espacio', 'autos', 'abstracto', 'otros', 'live', 'general', '', ' '];

        const result = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: "$tags" },
            // 🛡️ NORMALIZACIÓN: Pasamos a minúsculas y quitamos espacios en blanco
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

        // Verificar si ya está guardado
        const isSaved = user.savedWallpapers.includes(wallpaperId);

        if (isSaved) {
            // Si ya existe, lo quitamos (Unsave)
            user.savedWallpapers = user.savedWallpapers.filter(
                (id) => id.toString() !== wallpaperId
            );
        } else {
            // Si no existe, lo agregamos (Save)
            user.savedWallpapers.push(wallpaperId);
        }

        await user.save();
        
        res.json({ 
            msg: isSaved ? 'Quitado de guardados' : 'Guardado en tu colección', 
            savedCount: user.savedWallpapers.length,
            isSaved: !isSaved 
        });
    } catch (err) {
        res.status(500).send('Error al procesar la colección');
    }
});

// --- RUTA: OBTENER TODOS MIS GUARDADOS (Para la pestaña de Biblioteca) ---
router.get('/my/library', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate({
            path: 'savedWallpapers',
            populate: { path: 'artist', select: 'username profilePic isVerified' }
        });
        res.json(user.savedWallpapers);
    } catch (err) {
        res.status(500).send('Error');
    }
});

module.exports = router;  