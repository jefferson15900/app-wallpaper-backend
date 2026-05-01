const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const TagMap = require('../models/TagMap');
const FeedCache = require('../models/FeedCache'); // El que creamos hoy
const mongoose = require('mongoose');
const nlp = require('compromise');
const { cloudinary } = require('../config/cloudinary');
const aiQueue = require('../services/aiQueue');
const { cleanTags } = require('../config/tags');
const { resolveToCanonical, resolveTagsArray } = require('../utils/tagResolver');

// ==========================================
// 🚀 FUNCIÓN 1: FEED "PARA TI" (DISCOVERY)
// ==========================================
exports.getDiscoveryFeed = async (req, res) => {
    try {
        const { tags, limit = 16 } = req.query;
        const parsedLimit = parseInt(limit);
        const userId = req.user?.id; // req.user vendrá del middleware de auth (opcional)

        // 1. 🛡️ INTENTAR ENTREGAR DESDE CACHE
        if (userId) {
            const user = await User.findById(userId).select('isFeedDirty');
            
            // Si el feed NO está sucio, buscamos en la tabla de cache
            if (user && !user.isFeedDirty) {
                const cache = await FeedCache.findOne({ userId }).populate({
                    path: 'wallpapers',
                    populate: { path: 'artist', select: 'username profilePic isVerified isActive' }
                });

                if (cache && cache.wallpapers.length > 0) {
                    // Filtramos por si algún wallpaper fue borrado o el artista desactivado
                    const validWalls = cache.wallpapers.filter(w => w && w.artist && w.artist.isActive !== false);
                    
                    console.log("⚡ [CACHE] Entregando feed guardado");
                    return res.json(validWalls.sort(() => 0.5 - Math.random()).slice(0, parsedLimit));
                }
            }
        }

        // 2. 🧠 SI NO HAY CACHE O ESTÁ SUCIO -> EJECUTAR LOGICA PESADA (ADN)
        const userTags = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
        
        let pipeline = [];
        let baseMatch = { status: 'approved' };

        // --- (Tu lógica de Pipeline de ADN que ya tienes) ---
        pipeline.push({ $match: baseMatch });

        if (userTags.length > 0) {
            pipeline.push({
                $addFields: {
                    affinityScore: {
                        $size: { $ifNull: [{ $filter: { input: { $ifNull: ['$tags', []] }, as: 'tag', cond: { $in: ['$$tag', userTags] } } }, []] }
                    }
                }
            });
            pipeline.push({
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
            });
            pipeline.push({ $sort: { affinityGroup: 1, affinityScore: -1 } });
            pipeline.push({ $limit: parsedLimit * 3 }); 
            pipeline.push({ $sample: { size: parsedLimit } });
        } else {
            pipeline.push({ $sample: { size: parsedLimit } });
        }

        // Join con artista
        pipeline.push({ $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } });
        pipeline.push({ $unwind: '$artist' });
        pipeline.push({ $match: { 'artist.isActive': { $ne: false } } });
        pipeline.push({ $project: { 'artist.password': 0, 'artist.email': 0, 'artist.pushToken': 0, 'artist.interests': 0 } });

        const results = await Wallpaper.aggregate(pipeline);

        // 3. 💾 GUARDAR EN CACHE PARA LA PRÓXIMA VEZ
        if (userId && results.length > 0) {
            const wallpaperIds = results.map(r => r._id);
            await FeedCache.findOneAndUpdate(
                { userId },
                { wallpapers: wallpaperIds, createdAt: new Date() },
                { upsert: true }
            );
            await User.findByIdAndUpdate(userId, { isFeedDirty: false });
            console.log("🧠 [AGGREGATION] Nuevo feed generado y guardado en cache");
        }

        res.json(results);

    } catch (err) {
        console.error("Error en Discovery:", err);
        res.status(500).json({ msg: 'Error al obtener feed' });
    }
};


// ==========================================
// 🔍 FUNCIÓN 2: BÚSQUEDA PURA (TEXTO)
// ==========================================
exports.searchWallpapers = async (req, res) => {
    try {
        const { q, limit = 16, page = 1, exclude, type, premium } = req.query;
        const parsedLimit = parseInt(limit);
        const skip = (parseInt(page) - 1) * parsedLimit;

        if (!q || q.trim() === '') return res.json([]);

        const rawSearch = q.trim().toLowerCase();

        // 1. INTELIGENCIA NLP: Singularizar (Ej: "Motos" -> "Moto")
        const singularSearch = (() => {
            const singular = nlp(rawSearch).nouns().toSingular().text().trim();
            return singular && Math.abs(singular.length - rawSearch.length) < 10 ? singular : rawSearch;
        })();

        // 2. TRADUCCIÓN: Resolver término canónico (ES -> EN)
        const canonical = await resolveToCanonical(singularSearch);

        // 3. EXPANSIÓN: Buscar sinónimos en el TagMap
        const allSynonyms = await TagMap.find({ canonical }).lean();
        const expandedTerms = new Set([rawSearch, singularSearch, canonical]);
        allSynonyms.forEach(t => {
            expandedTerms.add(t.original);
            const s = nlp(t.original).nouns().toSingular().text().trim();
            if (s) expandedTerms.add(s);
        });

        const queryString = [...expandedTerms].filter(t => t && t.length >= 2).join(' ');

        // 4. FILTROS ADICIONALES
        let matchQuery = { status: 'approved' };
        if (type && type !== 'all') matchQuery.type = type;
        if (premium === 'true') matchQuery.price = { $gt: 0 };

        // Manejo de exclusión (para no repetir resultados en scroll)
        if (exclude) {
            const excludeIds = exclude.split(',').filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
            if (excludeIds.length > 0) matchQuery._id = { $nin: excludeIds };
        }

        // 5. PIPELINE DE ATLAS SEARCH
        const useFuzzy = singularSearch.length > 6;
        const pipeline = [
            {
                $search: {
                    index: "default",
                    text: {
                        query: queryString,
                        path: ["tags"], // Buscamos solo en etiquetas (ya no hay títulos)
                        ...(useFuzzy ? { fuzzy: { maxEdits: 1, prefixLength: 4 } } : {})
                    }
                }
            },
            { $addFields: { score: { $meta: "searchScore" } } },
            { $match: matchQuery },
            { $sort: { score: -1 } },
            { $skip: skip },
            { $limit: parsedLimit },
            { 
                $lookup: { 
                    from: 'users', 
                    localField: 'artist', 
                    foreignField: '_id', 
                    as: 'artist' 
                } 
            },
            { $unwind: '$artist' },
            // Filtro de seguridad (Solo artistas activos)
            { $match: { 'artist.isActive': { $ne: false } } },
            { $project: { score: 0, 'artist.password': 0, 'artist.email': 0, 'artist.pushToken': 0 } }
        ];

        const results = await Wallpaper.aggregate(pipeline);
        res.json(results.map(item => ({ ...item, price: item.price ?? 0 })));

    } catch (err) {
        console.error("❌ Error en Búsqueda:", err);
        res.status(500).json({ msg: 'Error interno en el buscador' });
    }
};


// ==========================================
// 🕒 FUNCIÓN 3: LO MÁS NUEVO (EXPLORAR)
// ==========================================
exports.getLatestWallpapers = async (req, res) => {
    try {
        const { limit = 16, page = 1, type } = req.query;
        const parsedLimit = parseInt(limit);
        const skip = (parseInt(page) - 1) * parsedLimit;

        let matchQuery = { status: 'approved' };
        if (type && type !== 'all') matchQuery.type = type;

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
            // 🚀 Solo artistas que no hayan desactivado su cuenta
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

        res.json(walls.map(item => ({ ...item, price: item.price ?? 0 })));
    } catch (err) {
        console.error("Error en Latest:", err);
        res.status(500).send('Error al obtener novedades');
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

        // 1. Validar permisos para video
        const user = await User.findById(req.user.id).lean();
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        if (isVideo && user.role !== 'admin') {
            await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'video' })
                .catch(e => console.error('❌ Error limpiando video:', e));
            return res.status(403).json({ msg: 'Solo el administrador puede subir videos' });
        }

        // 2. Extraer datos del body
        const { tags, price, manualAIResult } = req.body;
        let rawTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        let isAITagged = false;

        // 🚀 LÓGICA DE BYPASS: PROCESAR JSON MANUAL SI EXISTE
        if (manualAIResult && manualAIResult.trim() !== "") {
            try {
                const parsed = JSON.parse(manualAIResult); // Espera: [{"en":"dog","es":"perro"}, ...]
                
                if (Array.isArray(parsed)) {
                    // A. Extraer palabras para las etiquetas del wallpaper
                    const manualEn = parsed.map(t => t.en.toLowerCase().trim());
                    const manualEs = parsed.map(t => t.es.toLowerCase().trim());
                    
                    // Combinamos etiquetas del usuario con las del JSON
                    rawTags = [...new Set([...rawTags, ...manualEn, ...manualEs])];

                    // B. Alimentar el TagMap (Diccionario Global) inmediatamente
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
                        console.log("📚 TagMap actualizado manualmente desde Upload");
                    }

                    isAITagged = true; // Marcamos como procesado para no llamar a la IA de Google
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

        if (!isVideo && !isAITagged) {
            aiQueue.addJob({
                wallpaperId: newWallpaper._id,
                imageUrl:    req.file.path,
                baseTags:    finalTags
            });
        } else {
            console.log(`✅ [UPLOAD] ${isAITagged ? 'Bypass IA activado (JSON Manual)' : 'Video detectado (Sin IA)'}`);
        }

    } catch (err) {
        console.error('❌ ERROR EN UPLOAD:', err);

        if (req.file?.filename) {
            const resourceType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
            await cloudinary.uploader.destroy(req.file.filename, { resource_type: resourceType })
                .catch(e => console.error('❌ Error en limpieza post-error:', e));
        }

        res.status(500).json({ msg: 'Error interno en la subida' });
    }
};