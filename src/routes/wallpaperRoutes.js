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
const { cleanTags, SYNONYMS } = require('../config/tags');
const nlp = require('compromise'); 
const TagMap = require('../models/TagMap');
const { resolveToCanonical , resolveTagsArray  } = require('../utils/tagResolver');

let expo = new Expo();

// VARIABLES PARA CACHÉ #HASHTAGS
let trendingTagsCache = [];
let lastTagsUpdate = null;


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
        const { search, category, limit = 16, page = 1, random, type, artistId, premium, exclude } = req.query;

        const parsedLimit = parseInt(limit);
        const skip = (parseInt(page) - 1) * parsedLimit;

        // ── Filtro base ──────────────────────────────────────────────────
        let matchQuery = { status: 'approved' }; // ⚠️ RECUERDA: Si no están aprobados, no saldrán
        if (category && category !== 'Todos') matchQuery.category = category;
        if (type && type !== 'all') matchQuery.type = type;
        if (premium === 'true') matchQuery.price = { $gt: 0 };
        if (artistId) {
            try {
                matchQuery.artist = new mongoose.Types.ObjectId(artistId);
            } catch (e) {
                return res.status(400).json({ msg: 'ID de artista inválido' });
            }
        }

        // ── BÚSQUEDA ─────────────────────────────────────────────────────
        if (search && search.trim() !== '') {
            const rawSearch = search.trim().toLowerCase();

            const singularSearch = (() => {
                const singular = nlp(rawSearch).nouns().toSingular().text().trim();
                return singular && Math.abs(singular.length - rawSearch.length) < 10
                    ? singular
                    : rawSearch;
            })();

            // 🚀 CORRECCIÓN AQUÍ: Destructuramos el objeto para obtener solo el string
            const { canonical } = await resolveToCanonical(singularSearch);

            // Buscamos todos los términos relacionados en el TagMap
            const allSynonyms = await TagMap.find({ canonical }).lean();
            
            const expandedTerms = new Set([rawSearch, singularSearch, canonical]);
            allSynonyms.forEach(t => {
                expandedTerms.add(t.original);
                const s = nlp(t.original).nouns().toSingular().text().trim();
                if (s) expandedTerms.add(s);
            });

            const queryString = [...expandedTerms]
                .filter(t => t && t.length >= 2)
                .join(' ');

            const useFuzzy = singularSearch.length > 5;

            let excludeIds = [];
            if (exclude) {
                excludeIds = exclude.split(',')
                    .filter(id => mongoose.Types.ObjectId.isValid(id))
                    .map(id => new mongoose.Types.ObjectId(id));
            }

            const finalMatch = { ...matchQuery };
            if (excludeIds.length > 0) finalMatch._id = { $nin: excludeIds }; 

            const pipeline = [
                {
                    $search: {
                        index: "default",
                        text: {
                            query: queryString,
                            // 🚀 MEJORA: También buscamos en el campo "category" del Wallpaper
                            path: ["title", "tags", "category"], 
                            ...(useFuzzy ? { fuzzy: { maxEdits: 1, prefixLength: 3 } } : {})
                        }
                    }
                },
                { $addFields: { score: { $meta: "searchScore" } } },
                { $match: finalMatch },
                ...(random === 'true'
                    ? [{ $sample: { size: parsedLimit } }]
                    : [{ $sort: { score: -1 } }, { $skip: skip }, { $limit: parsedLimit }]
                ),
                { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
                { $unwind: { path: '$artist', preserveNullAndEmptyArrays: true } },
                { $project: { score: 0, 'artist.password': 0, 'artist.email': 0, 'artist.pushToken': 0 } }
            ];

            const searchResults = await Wallpaper.aggregate(pipeline);
            return res.json(searchResults.map(item => ({ ...item, price: item.price ?? 0 })));
        }



 //  ─────────────────────────────────────────────────────────────────
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

    // ── 3. JOIN CON ARTISTA Y FILTRO DE ACTIVIDAD ─────────────────
    pipeline.push(
        { 
            $lookup: { 
                from: 'users', 
                localField: 'artist', 
                foreignField: '_id', 
                as: 'artist' 
            } 
        },
        { $unwind: '$artist' },
        // 🚀 FILTRO CRÍTICO: Solo artistas activos
        { $match: { 'artist.isActive': { $ne: false } } } 
    );

    // ── 4. ORDEN Y MUESTREO ───────────────────────────────────────
    if (userTags.length > 0) {
        pipeline.push(
            { $sort: { affinityGroup: 1, affinityScore: -1 } },
            { $limit: parsedLimit * 3 }, 
            { $sample: { size: parsedLimit } }
        );
    } else {
        pipeline.push({ $sample: { size: parsedLimit } });
    }

    // Limpieza de campos sensibles
    pipeline.push({
        $project: {
            'artist.password': 0, 
            'artist.email': 0,
            'artist.pushToken': 0,
            'artist.interests': 0,
            'artist.lastActiveAt': 0,
            'affinityScore': 0,
            'affinityGroup': 0
        }
    });

    const results = await Wallpaper.aggregate(pipeline);
    return res.json(results.map(item => ({ ...item, price: item.price ?? 0 })));
 }

        // --- 🔵 CASO 3: NAVEGACIÓN NORMAL (Cronológica / Perfil de Artista) ---
 const walls = await Wallpaper.aggregate([
    { $match: matchQuery },
    {
        $lookup: {
            from: 'users',
            localField: 'artist',
            foreignField: '_id',
            as: 'artist'
        }
    },
    { $unwind: '$artist' },
    // 🚀 FILTRO CRÍTICO: Solo artistas activos
    { $match: { 'artist.isActive': { $ne: false } } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: parsedLimit },
    {
        $project: {
            'artist.password': 0,
            'artist.email': 0,
            'artist.pushToken': 0,
            'artist.interests': 0
        }
    }
]);

// Aseguramos que el campo price siempre exista para el frontend
const sanitizedWalls = walls.map(item => ({
    ...item,
    price: item.price ?? 0
}));

res.json(sanitizedWalls);

     } catch (err) {
        console.error("❌ Error crítico en ruta principal:", err);
        res.status(500).json({ msg: 'Error interno del servidor' });
    }

});


// Obtener wallpapers de un artista específico

router.get('/artist/:artistId', async (req, res) => {
    try {
        const { artistId } = req.params; // Extraemos el ID
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;
        const artistObjId = new mongoose.Types.ObjectId(artistId);
        const totalCount = await Wallpaper.countDocuments({ artist: artistObjId });
        const wallpapers = await Wallpaper.find({ artist: artistObjId })
            .populate('artist', 'username profilePic isVerified')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
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
const TagMap = require('../models/TagMap'); // Asegúrate de tenerlo importado arriba

router.post('/upload', [auth, uploadCloud.single('image')], async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: 'No se recibió media' });
 
        const isVideo = req.file.mimetype.startsWith('video');
        const { title, tags, category, price, manualMetadata } = req.body;

        const user = await User.findById(req.user.id).lean();
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        const isAdmin = user.role === 'admin';

        if (isVideo && !isAdmin) {
            await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'video' }).catch(() => {});
            return res.status(403).json({ msg: 'Solo el administrador sube Live Wallpapers' });
        }

        // ── 1. Preparación inicial de tags del formulario ──
        const rawTags = [title, ...(tags ? tags.split(',') : []), category].filter(Boolean);
        const cleaned = cleanTags(rawTags);
        let finalTags = await resolveTagsArray(cleaned);
        let selectedCategory = category || 'Otros';
        let processedManually = false;

        // ── 2. Procesamiento de Metadatos Manuales (JSON) ──
        if (manualMetadata && manualMetadata.trim() !== "") {
            try {
                const parsedData = JSON.parse(manualMetadata);
                
                if (Array.isArray(parsedData) && parsedData.length > 0) {
                    // A. Alimentar el TagMap (Cerebro)
                    const tagMapOps = parsedData.map(item => ({
                        updateOne: {
                            filter: { original: item.es.toLowerCase().trim() },
                            update: { 
                                $set: { 
                                    canonical: item.en.toLowerCase().trim(),
                                    category: item.category,
                                    language: 'es'
                                } 
                            },
                            upsert: true
                        }
                    }));
                    await TagMap.bulkWrite(tagMapOps, { ordered: false });

                    // B. Extraer tags del JSON para el Wallpaper
                    const manualTagsList = parsedData.flatMap(i => [
                        i.en.toLowerCase().trim(), 
                        i.es.toLowerCase().trim()
                    ]);
                    
                    // C. Combinar todo
                    finalTags = [...new Set([...finalTags, ...manualTagsList])];
                    
                    // D. Determinar categoría dominante del JSON
                    const counts = {};
                    parsedData.forEach(i => { if(i.category) counts[i.category] = (counts[i.category] || 0) + 1 });
                    const dominant = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
                    if (dominant) selectedCategory = dominant[0];

                    processedManually = true;
                }
            } catch (e) {
                console.error("❌ Error parseando manualMetadata:", e.message);
            }
        }

        // ── 3. Crear registro en Base de Datos ──
        const newWallpaper = new Wallpaper({
            title: title?.trim() || finalTags[0] || 'Vexel Art',
            tags: finalTags,
            imageUrl: req.file.path,
            public_id: req.file.filename,
            category: selectedCategory,
            artist: req.user.id,
            type: isVideo ? 'video' : 'image',
            status: isVideo ? 'approved' : 'pending',
            price: isAdmin ? Math.max(0, Number(price) || 0) : 0,
            isAITagged: processedManually // Si fue manual, ya no necesita IA
        });

        await newWallpaper.save();

        // ── 4. Actualizar contador del usuario ──
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: 1 } });

        res.json(newWallpaper);

        // ── 5. Encolar job de IA solo si NO fue manual y NO es video ──
        if (!processedManually && !isVideo) {
            aiQueue.addJob({
                wallpaperId: newWallpaper._id,
                imageUrl: req.file.path,
                baseTags: finalTags
            });
        }

    } catch (err) {
        console.error('❌ ERROR EN UPLOAD:', err);
        if (req.file?.filename) {
            const resourceType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
            await cloudinary.uploader.destroy(req.file.filename, { resource_type: resourceType }).catch(() => {});
        }
        res.status(500).json({ msg: 'Error interno en la subida' });
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

// --- RUTA: OBTENER TODOS MIS GUARDADOS (Para la pestaña de Biblioteca) ---
// En tu archivo de rutas del backend:
router.get('/my/library', auth, async (req, res) => {
    try {

        const user = await User.findById(req.user.id);
        const userPopulated = await User.findById(req.user.id).populate({
            path: 'savedWallpapers',
            select: 'imageUrl title type tags category artist price',
            populate: { path: 'artist', select: 'username profilePic isVerified' }
        });

        const cleanLibrary = (userPopulated.savedWallpapers || []).filter(item => item !== null);
        console.log(`🔎 [DEBUG GET] Total tras populate y limpieza: ${cleanLibrary.length}`);
        res.json(cleanLibrary);

    } catch (err) {
        console.error("🔥 Error en GET library:", err);
        res.status(500).json({ msg: 'Error de servidor' });
    }
});

// BUSCADOR DE TAGS DINÁMICO
router.get('/tags/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.json([]);

        const trimmed = q.trim();
        if (trimmed.length < 1) return res.json([]);
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const results = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: '$tags' },
            { $match: { tags: { $regex: `^${escaped}`, $options: 'i' } } },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 15 },
            { $project: { _id: 0, tag: '$_id', count: 1 } }
        ]);

        res.json(results.map(r => r.tag));

    } catch (err) {
        console.error('Tag search error:', err);
        res.status(500).json({ error: 'Error buscando tags' });
    }
});


module.exports = router;  