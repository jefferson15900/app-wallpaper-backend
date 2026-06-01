const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const TagMap = require('../models/TagMap');
const FeedCache = require('../models/FeedCache'); // El que creamos hoy
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nlp = require('compromise');
const { cloudinaryPrimary, cloudinarySecondary } = require('../config/cloudinary');
const aiQueue = require('../services/aiQueue');
const { cleanTags } = require('../config/tags');
const { resolveToCanonical, resolveTagsArray } = require('../utils/tagResolver');
const Visitor = require('../models/Visitor');
const RelatedCache = require('../models/RelatedCache');
const TagSuggestion = require('../models/TagSuggestion');



// 🔀 Utilidad: Mezclar array (Algoritmo Fisher-Yates)
const shuffleArray = (array) => {
    const shuffled = [...array]; // copia defensiva
    let currentIndex = shuffled.length;

    while (currentIndex !== 0) {
        const randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [shuffled[currentIndex], shuffled[randomIndex]] = 
            [shuffled[randomIndex], shuffled[currentIndex]];
    }

    return shuffled;
};

// 💾 Utilidad: Guardar Cache en segundo plano
const saveFeedCacheAsync = async (userId, results) => {    
    // Evitar guardar un cache vacío que parecería válido
    if (!results?.length) {
        return;
    }

    try {
        // Ambas escrituras son independientes → se ejecutan en paralelo
        await Promise.all([
            FeedCache.findOneAndUpdate(
                { userId },
                { snapshot: results, updatedAt: new Date() },
                { upsert: true }
            ),
            User.findByIdAndUpdate(userId, { isFeedDirty: false }),
        ]);

    } catch (err) {
        // Loguear el error completo, no solo el mensaje
        console.error(`❌ [CACHE] Error guardando cache para usuario ${userId}:`, err);
    }
};


// ==========================================
// 🚀 FUNCIÓN 1: FEED "PARA TI" (DISCOVERY)
// ==========================================
exports.getDiscoveryFeed = async (req, res) => {
    try {
        const { tags, exclude, category, type, artistId, premium } = req.query;

        // ── Validación de parámetros ──────────────────────────────────────────
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 16));
        const skip  = (page - 1) * limit;

        // ── Identificar usuario (optional) ───────────────────────────────────
        let userId   = null;
        let userDoc  = null;
        const token  = req.header('x-auth-token');

        if (token && token.trim() !== '') {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                userId = decoded.user.id;
            } catch (jwtErr) { 
                console.error(`[DEBUG-FEED] Token recibido pero INVÁLIDO: ${jwtErr.message}`);
            }
        } else {
            console.log(`[DEBUG-FEED] No se recibió token en los headers (o está vacío)`);
        }


        // ── A. CACHE (solo página 1, usuario logueado) ────────────────────────
        const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

        if (page === 1 && userId) {
            // Una sola query: traemos isFeedDirty y el cache juntos
            [userDoc] = await Promise.all([
                User.findById(userId).select('isFeedDirty').lean(),
            ]);

            if (userDoc && !userDoc.isFeedDirty) {
                const cache = await FeedCache.findOne({ userId }).lean();
                
                const isFresh =
                    cache?.snapshot?.length > 0 &&
                    Date.now() - new Date(cache.updatedAt) < CACHE_TTL_MS;

                if (isFresh) {
                    console.log(`[DEBUG-FEED] Devolviendo respuesta DESDE CACHÉ ⚡`);
                    // snapshot ya tiene el formato final — sin necesidad de filtrar aquí
                    return res.json(
                        shuffleArray(cache.snapshot)
                            .slice(0, limit)
                            .map(item => ({ ...item, price: item.price ?? 0 }))
                    );
                }
            }
        }

        // ── B. QUERY PESADA ───────────────────────────────────────────────────
        const baseMatch = { status: 'approved' };
        if (category && category !== 'Todos') baseMatch.category = category;
        if (type && type !== 'all')           baseMatch.type = type;
        if (premium === 'true')               baseMatch.price = { $gt: 0 };

        if (artistId && mongoose.Types.ObjectId.isValid(artistId)) {
            baseMatch.artist = new mongoose.Types.ObjectId(artistId);
        }

        // Tope en exclusiones para no destruir índices con $nin masivo
        if (exclude) {
            const excludeIds = exclude
                .split(',')
                .slice(0, 100)
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));

            if (excludeIds.length > 0) baseMatch._id = { $nin: excludeIds };
        }

        const userTags = tags
            ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
            : [];

        // ── Pipeline ──────────────────────────────────────────────────────────
        // Orden correcto: filtrar → acotar → join → paginar
        const pipeline = [];

        if (userTags.length > 0) {
            pipeline.push(
                { $match: baseMatch },
                {
                    $addFields: {
                        affinityScore: {
                            $size: {
                                $ifNull: [{
                                    $filter: {
                                        input: { $ifNull: ['$tags', []] },
                                        as  : 'tag',
                                        cond: { $in: ['$$tag', userTags] },
                                    },
                                }, []],
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        affinityGroup: {
                            $switch: {
                                branches: [
                                    { case: { $gte: ['$affinityScore', 3] }, then: 0 },
                                    { case: { $gte: ['$affinityScore', 1] }, then: 1 },
                                ],
                                default: 2,
                            },
                        },
                    },
                },
                { $sort  : { affinityGroup: 1, affinityScore: -1 } },
                // Acotamos el pool ANTES del join para no hacer lookup de miles de docs
                { $limit : limit * 4 },
                { $sample: { size: limit * 2 } }
            );
        } else {
            pipeline.push(
                { $match : baseMatch },
                { $sample: { size: limit * 2 } } // pool generoso para absorber artistas inactivos
            );
        }

        // Join y filtro de artistas DESPUÉS de acotar el pool
        pipeline.push(
            { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
            { $unwind: '$artist' },
            { $match : { 'artist.isActive': { $ne: false } } },
            { $limit : limit }, // límite final tras filtrar inactivos
            {
                $project: {
                    'artist.password'    : 0,
                    'artist.email'       : 0,
                    'artist.pushToken'   : 0,
                    'artist.interests'   : 0,
                    'artist.lastActiveAt': 0,
                    affinityScore        : 0,
                    affinityGroup        : 0,
                },
            }
        );

        const results = await Wallpaper.aggregate(pipeline);

        // ── C. GUARDAR CACHE (fire-and-forget, solo pág. 1) ──────────────────
        if (page === 1 && userId && results.length > 0) {
            saveFeedCacheAsync(userId, results); // guarda snapshot completo, no solo IDs
        }

        return res.json(results.map(item => ({ ...item, price: item.price ?? 0 })));

    } catch (err) {
        console.error('❌ Error en Discovery:', err);
        return res.status(500).json({ msg: 'Error interno al generar el feed' });
    }
};



// ==========================================
// 🔍 FUNCIÓN 2: BÚSQUEDA PURA (TEXTO)
// ==========================================
exports.searchWallpapers = async (req, res) => {
    try {
        const { q, exclude, type, premium, seed } = req.query;

        // ── Validación de parámetros ──────────────────────────────────────────
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 16));
        const skip  = (page - 1) * limit;

        if (!q?.trim()) return res.json([]);
        const rawSearch = q.trim().toLowerCase();

        // Seed: debe ser finito y estar en rango [0, 1)
        const parsedSeed = parseFloat(seed);
        const randomSeed = Number.isFinite(parsedSeed) && parsedSeed >= 0 && parsedSeed < 1
            ? parsedSeed
            : Math.random();

        // ── NLP ───────────────────────────────────────────────────────────────
        const singularSearch = (() => {
            const s = nlp(rawSearch).nouns().toSingular().text().trim();
            return s?.length >= 2 ? s : rawSearch;
        })();

        // ── Traducción + sinónimos en paralelo ────────────────────────────────
        const [canonical, allSynonyms] = await Promise.all([
            resolveToCanonical(singularSearch),
            TagMap.find({ original: { $in: [rawSearch, singularSearch] } }).lean(),
        ]);

        const canonicalSynonyms = canonical
            ? await TagMap.find({ canonical }).lean()
            : [];

        const expandedTerms = new Set(
            [rawSearch, singularSearch, canonical].filter(Boolean)
        );
        [...allSynonyms, ...canonicalSynonyms].forEach(t => {
            if (t.original) expandedTerms.add(t.original);
        });

        const queryString = [...expandedTerms]
         .filter(t => t && t.length >= 2)
         .flatMap(t => [t, t.replace('-', ''), t.replace(' ', '')])
         .slice(0,20)
         .join(' ');

        // ── Filtros base ──────────────────────────────────────────────────────
        const matchQuery = { status: 'approved' };
        if (type && type !== 'all') matchQuery.type = type;
        if (premium === 'true')     matchQuery.price = { $gt: 0 };

        if (exclude) {
            const ids = exclude
                .split(',')
                .slice(0, 100)
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            if (ids.length) matchQuery._id = { $nin: ids };
        }

        // ── Pipeline ──────────────────────────────────────────────────────────
        const useFuzzy = singularSearch.length > 6;

        const pipeline = [
    {
    $search: {
      index: "default",
       text: {
         query: queryString,
         path: ["tags"],
        // 🚀 MEJORA: Hacemos el fuzzy más sensible
        fuzzy: {
            maxEdits: 1,      // Permite 1 letra de diferencia (ej: Spidreman -> Spiderman)
            prefixLength: 3,  // Las primeras 3 letras deben ser iguales
            maxExpansions: 50
        }
       }
   }, 
},
{ $addFields: { score: { $meta: 'searchScore' } } },
{ $match: matchQuery },
{ $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
{ $unwind: '$artist' },
{ $match: { 'artist.isActive': { $ne: false } } },

// Azar multiplicado aquí, fuera de Atlas Search
{
    $addFields: {
        randomizedScore: {
            $multiply: [
                '$score',
                {
                    $mod: [
                        {
                            $add: [
                                { $toLong: { $toDate: "$_id" } },
                                Math.floor(randomSeed * 999983)
                            ]
                        },
                        997
                    ]
                }
            ]
        }
    }
},
{ $sort : { randomizedScore: -1 } },
{ $skip : skip },
{ $limit: limit },
{
    $project: {
        score          : 0,
        randomizedScore: 0,
        'artist.password' : 0,
        'artist.email'    : 0,
        'artist.pushToken': 0,
    },
},
        ];

        const results = await Wallpaper.aggregate(pipeline);
        return res.json(results.map(item => ({ ...item, price: item.price ?? 0 })));
         
    } catch (err) {
        console.error('❌ Error en búsqueda:', err);
        return res.status(500).json({ msg: 'Error interno en el buscador' });
    } 
};



// ==========================================
// 🕒 FUNCIÓN 3: LO MÁS NUEVO (EXPLORAR)
// ==========================================
exports.getLatestWallpapers = async (req, res) => {
    try {
        const { type } = req.query;
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 16));
        const skip  = (page - 1) * limit;

        const matchQuery = { status: 'approved' };
        if (type && type !== 'all') matchQuery.type = type;

        const walls = await Wallpaper.aggregate([
            { $match: matchQuery },

            // Índice recomendado: { status: 1, createdAt: -1 }
            { $sort: { createdAt: -1 } },

            // Lookup ANTES del skip — igual que en searchWallpapers
            { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
            { $unwind: '$artist' },
            { $match: { 'artist.isActive': { $ne: false } } },

            // Paginar sobre el set ya filtrado
            { $skip : skip },
            { $limit: limit },

            {
                $project: {
                    'artist.password' : 0,
                    'artist.email'    : 0,
                    'artist.pushToken': 0,
                    'artist.interests': 0,
                },
            },
        ]);

        return res.json(walls.map(item => ({ ...item, price: item.price ?? 0 })));

    } catch (err) {
        console.error('❌ Error en Latest:', err);
        return res.status(500).json({ msg: 'Error al obtener novedades' });
    }
};

// ==========================================
// 🎨 FUNCIÓN 4: GALERÍA DE ARTISTA
// ==========================================
exports.getArtistWallpapers = async (req, res) => {
    try {
        const { artistId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;

        if (!mongoose.Types.ObjectId.isValid(artistId)) {
            return res.status(400).json({ msg: 'ID de artista no válido' });
        }

        const artistObjId = new mongoose.Types.ObjectId(artistId);

        // Ejecutamos el conteo y la búsqueda en paralelo para ganar velocidad
        const [totalCount, wallpapers] = await Promise.all([
            Wallpaper.countDocuments({ artist: artistObjId, status: 'approved' }),
            Wallpaper.find({ artist: artistObjId, status: 'approved' })
                .populate('artist', 'username profilePic isVerified')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean() // Hace la consulta mucho más ligera
        ]);

        res.json({ wallpapers, totalCount });
    } catch (err) {
        console.error("Error en Artist Gallery:", err);
        res.status(500).send('Error al obtener galería');
    }
};

// ==========================================
// 🚀 FUNCIÓN 5: SUBIR WALLPAPER (CON BYPASS IA)
// ==========================================
exports.uploadWallpaper = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: 'No se recibió media' });

        const isVideo = req.file.mimetype.startsWith('video');
        const user = await User.findById(req.user.id).lean();
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // 🛡️ REGLA A: BLOQUEO TOTAL PARA USUARIOS NO VERIFICADOS
        if (user.role !== 'admin' && !user.isVerified) {
            const resourceType = isVideo ? 'video' : 'image';
            const cloudinaryInstance = isVideo ? cloudinarySecondary : cloudinaryPrimary;
            await cloudinaryInstance.uploader.destroy(req.file.filename, { resource_type: resourceType })
                .catch(e => console.error('❌ Error limpiando archivo no autorizado:', e));
            return res.status(403).json({ 
                msg: 'Acceso restringido: Solo los Artistas Verificados pueden publicar en Vexel.' 
            });
        }

        // 🛡️ REGLA B: RESTRICCIÓN DE VIDEO (Solo para Admins)
        if (isVideo && user.role !== 'admin') {
            await cloudinarySecondary.uploader.destroy(req.file.filename, { resource_type: 'video' })
                .catch(e => console.error('❌ Error limpiando video:', e));
            return res.status(403).json({ msg: 'Solo el administrador puede subir Live Wallpapers.' });
        }

        // 2. Extraer datos del body
        const { tags, price, manualAIResult, useAI } = req.body; // 👈 useAI agregado
        let rawTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        let isAITagged = false;

        // 🚀 LÓGICA DE BYPASS: PROCESAR JSON MANUAL SI EXISTE
        if (manualAIResult && manualAIResult.trim() !== "") {
            try {
                const parsed = JSON.parse(manualAIResult);
                
                if (Array.isArray(parsed)) {
                    const manualEn = parsed.map(t => t.en.toLowerCase().trim());
                    const manualEs = parsed.map(t => t.es.toLowerCase().trim());
                    rawTags = [...new Set([...rawTags, ...manualEn, ...manualEs])];

                    const tagMapOps = parsed
                        .filter(t => t.en && t.es && t.en !== t.es)
                        .map(({ en, es }) => ({
                            updateOne: {
                                filter: { original: es.toLowerCase().trim() },
                                update: { $set: { canonical: en.toLowerCase().trim(), language: 'es' } },
                                upsert: true
                            }
                        }));
 
                    if (tagMapOps.length > 0) {
                        await TagMap.bulkWrite(tagMapOps, { ordered: false });
                    }

                    isAITagged = true;
                }
            } catch (jsonErr) { 
                console.error('❌ Error parseando manualAIResult:', jsonErr.message);
            }
        }

        // 3. Limpieza y normalización de etiquetas finales
        const cleaned = cleanTags(rawTags);
        const finalTags = await resolveTagsArray(cleaned);

        // 4. Crear registro en DB
        const newWallpaper = new Wallpaper({
            tags:      finalTags,
            imageUrl:  req.file.path,
            public_id: req.file.filename,
            artist:    req.user.id, 
            type:      isVideo ? 'video' : 'image',
            status:    'pending',
            isAITagged: isAITagged,
            price:     user.role === 'admin' ? Math.max(0, Number(price) || 0) : 0
        });

        await newWallpaper.save();
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: 1 } });

        res.json(newWallpaper);

        // 🤖 LÓGICA DE DECISIÓN DE IA
        // Entra a la cola solo si:
        // 1. No es video
        // 2. No se mandó JSON manual (bypass)
        // 3. El usuario NO apagó el botón (useAI !== 'false')
        if (!isVideo && !isAITagged && useAI !== 'false') {
            aiQueue.addJob({
                wallpaperId: newWallpaper._id,
                imageUrl:    req.file.path,
                baseTags:    finalTags
            });
        } else {
        }

    } catch (err) {
        console.error('❌ ERROR EN UPLOAD:', err);

        if (req.file?.filename) {
            const resourceType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
            const cloudinaryInstance = req.file.mimetype.startsWith('video') ? cloudinarySecondary : cloudinaryPrimary;
            await cloudinaryInstance.uploader.destroy(req.file.filename, { resource_type: resourceType })
                .catch(e => console.error('❌ Error en limpieza post-error:', e));
        }

        res.status(500).json({ msg: 'Error interno en la subida' });
    }
};


// ==========================================
// 🔍 FUNCIÓN 6: OBTENER RELACIONADOS (INFINITOS)
// ==========================================
exports.getRelatedWallpapers = async (req, res) => {
    try {
        const { id } = req.params;
        const page     = Math.max(1, parseInt(req.query.page)  || 1);
        const limit    = Math.min(50, parseInt(req.query.limit) || 12); // tope de seguridad
        const skip     = (page - 1) * limit;

        // ── 1. CACHE solo para página 1 ──────────────────────────────────────
        if (page === 1) {
            const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

            const cache = await RelatedCache.findOne({ wallpaperId: id });

            const isFresh =
                cache &&
                cache.snapshot?.length > 0 &&
                Date.now() - cache.updatedAt < CACHE_TTL_MS;

            if (isFresh) {
                return res.json(cache.snapshot); // snapshot ya tiene el formato final
            }
        }

        // ── 2. VALIDAR que el wallpaper original existe ──────────────────────
        const original = await Wallpaper.findById(id).lean();
        if (!original || !original.tags?.length) return res.json([]);

        // ── 3. AGGREGATE unificado (mismo formato siempre) ───────────────────
        //    Índice recomendado: { status:1, tags:1, createdAt:-1 }
        const results = await Wallpaper.aggregate([
            {
                $match: {
                    status : 'approved',
                    _id    : { $ne: original._id },
                    tags   : { $in: original.tags },
                },
            },
            {
                $addFields: {
                    commonTags: {
                        $size: { $setIntersection: ['$tags', original.tags] },
                    },
                },
            },
            { $sort: { commonTags: -1, createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $lookup: {
                    from         : 'users',
                    localField   : 'artist',
                    foreignField : '_id',
                    as           : 'artist',
                },
            },
            { $unwind: '$artist' },
            {
                $match: { 'artist.isActive': { $ne: false } },
            },
            {
                $project: {
                    'artist.password' : 0,
                    'artist.email'    : 0,
                    commonTags        : 0, // campo auxiliar, no necesario en respuesta
                },
            },
        ]);

        // ── 4. GUARDAR cache solo en página 1 ────────────────────────────────
        if (page === 1 && results.length > 0) {
            // Guardamos el snapshot completo (no solo IDs) → respuesta idéntica
            RelatedCache.findOneAndUpdate(
                { wallpaperId: id },
                { snapshot: results, updatedAt: new Date() },
                { upsert: true }
            ).catch(err => console.error('[RELATED] Error guardando cache:', err));
            // fire-and-forget: no bloqueamos la respuesta al usuario
        }

        return res.json(results);

    } catch (err) {
        console.error('[RELATED] Error:', err);
        return res.status(500).json({ msg: 'Error al obtener wallpapers relacionados' });
    }
};


// ==========================================
// 🆔 OBTENER UNO POR ID
// ==========================================
exports.getWallpaperById = async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id)
            .populate('artist', 'username profilePic isVerified instagram twitter tiktok facebook');
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });
        res.json(wallpaper);
    } catch (err) {
        res.status(500).json({ msg: 'Error al obtener el wallpaper' });
    }
};

// ==========================================
// 📚 OBTENER MI BIBLIOTECA (Favoritos)
// ==========================================
exports.getUserLibrary = async (req, res) => {
    try {
        const userPopulated = await User.findById(req.user.id).populate({
            path: 'savedWallpapers',
            select: 'imageUrl title type tags category artist price',
            populate: { path: 'artist', select: 'username profilePic isVerified' }
        });
        const cleanLibrary = (userPopulated.savedWallpapers || []).filter(item => item !== null);
        res.json(cleanLibrary);
    } catch (err) {
        res.status(500).json({ msg: 'Error al obtener biblioteca' });
    }
};

// ==========================================
// 🔍 BUSCADOR DE TAGS DINÁMICO (Sugerencias)
// ==========================================
exports.searchTags = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.json([]);

        const trimmed = q.trim();
        if (trimmed.length < 1) return res.json([]);

        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const results = await TagSuggestion.find(
            { tag: { $regex: `^${escaped}`, $options: 'i' } },
            { tag: 1, _id: 0 }
        )
        .sort({ count: -1 })
        .limit(15)
        .lean();

        return res.json(results.map(r => r.tag));

    } catch (err) {
        console.error('❌ Error buscando tags:', err);
        return res.status(500).json({ msg: 'Error buscando tags' });
    }
};

// ==========================================
// ❤️ DAR/QUITAR LIKE
// ==========================================
exports.toggleLike = async (req, res) => {
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
};

// ==========================================
// ⭐️ GUARDAR/QUITAR DE FAVORITOS
// ==========================================
exports.toggleSave = async (req, res) => {
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
};

// ==========================================
// 📥 REGISTRAR DESCARGA
// ==========================================
exports.registerDownload = async (req, res) => {
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
};

// ==========================================
// 🗑️ ELIMINAR WALLPAPER
// ==========================================
exports.deleteWallpaper = async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'No encontrado' });

        if (wallpaper.artist.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'No autorizado' });
        }

        // 1. Borrar de Cloudinary especificando el tipo de recurso
        if (wallpaper.public_id) {
            const cloudinaryInstance = wallpaper.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
            await cloudinaryInstance.uploader.destroy(wallpaper.public_id, {
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
};

// ==========================================
// 🛠️ ADMIN: QUITAR ETIQUETA ESPECÍFICA
// ==========================================
exports.adminRemoveTag = async (req, res) => {
    try {
        const { id } = req.params;
        const { tagToRemove } = req.body;
         const adminUser = await User.findById(req.user.id);

        // Validar que venga un tag
        if (!tagToRemove || typeof tagToRemove !== 'string') {
            return res.status(400).json({ msg: 'Tag inválido' });
        }

        if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado: Se requiere rol de Admin' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID inválido' });
        }

        const result = await Wallpaper.findByIdAndUpdate(
            id,
            { $pull: { tags: tagToRemove.trim().toLowerCase() } },
            { new: true }
        );

        if (!result) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // Actualizar el contador en TagSuggestion sin re-sync completo
        const stillExists = await Wallpaper.exists({
            status: 'approved',
            tags  : tagToRemove,
        });

        if (stillExists) {
            await TagSuggestion.updateOne(
                { tag: tagToRemove },
                { $inc: { count: -1 } }
            );
        } else {
            // Ningún wallpaper aprobado usa este tag — eliminarlo
            await TagSuggestion.deleteOne({ tag: tagToRemove });
        }

        return res.json({ msg: 'Etiqueta eliminada', tags: result.tags });

    } catch (err) {
        console.error('❌ Error en adminRemoveTag:', err);
        return res.status(500).json({ msg: 'Error al actualizar etiquetas' });
    }
};