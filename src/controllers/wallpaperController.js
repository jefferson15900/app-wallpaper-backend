const Wallpaper = require('../models/Wallpaper');
const User = require('../models/User');
const TagMap = require('../models/TagMap');
const FeedCache = require('../models/FeedCache'); // El que creamos hoy
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nlp = require('compromise');
const { cloudinaryPrimary, cloudinarySecondary } = require('../config/cloudinary');
const aiQueue = require('../services/aiQueue');
const { randomUUID } = require('node:crypto');
const { parseMetadata, parseAssetMetadata, searchTagsFor, searchDescriptionsFor, matchedAssetId, removeMetadataTag, metadataError, normalizeTerm } = require('../utils/wallpaperMetadata');
const { updateMetadata, mergeWithMetadata } = require('../services/wallpaperMetadataService');
const { cleanTags } = require('../config/tags');
const { resolveSearchConcepts, resolveTagsArray } = require('../utils/tagResolver');
const { searchKey, readSearchCursor, nextSearchCursor } = require('../utils/searchPagination');
const { cleanSearchQuery, IGNORED_SEARCH_WORDS, requiredSearchConcepts, searchWordFuzzy, SEARCH_TEXT_PATHS, SEARCH_VERSION } = require('../utils/searchQuery');
const Visitor = require('../models/Visitor');
const RelatedCache = require('../models/RelatedCache');
const TagSuggestion = require('../models/TagSuggestion');
const SearchLog = require('../models/SearchLog');
const { recordSearch, recordSearchOutcome, recordDownload, recordActivity, quietly } = require('../services/analyticsService');
const { validDeviceId } = require('../utils/analyticsDates');
const Spotlight = require('../models/Spotlight');
const FloatingBubble = require('../models/FloatingBubble');

// 💾 Utilidad: Guardar Log de Búsqueda en segundo plano
const saveSearchLogAsync = async (term, resultsCount) => {
    if (!term || term.length < 2) return;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await SearchLog.findOneAndUpdate(
            { term: term, date: today },
            { 
                $inc: { count: 1 },
                $set: { resultsCount: resultsCount }
            },
            { upsert: true }
        );
    } catch (err) {
        console.error("❌ [SearchLog] Error guardando log de búsqueda:", err.message);
    }
};



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
// 🔍 UTILERÍAS DE BÚSQUEDA INTELIGENTE
// ==========================================
const expandSpacedTags = async (term) => {
    if (!term || term.includes(' ') || term.length < 4) return [];
    try {
        const regexPattern = term.split('').map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        const matches = await TagSuggestion.find(
            { tag: { $regex: `^${regexPattern}$`, $options: 'i' } },
            { tag: 1, _id: 0 }
        ).limit(5).lean();
        
        return matches.map(m => m.tag);
    } catch (err) {
        console.error("❌ [Search] Error en expandSpacedTags:", err.message);
        return [];
    }
};

// ==========================================
// 🔍 FUNCIÓN 2: BÚSQUEDA PURA (TEXTO)
// ==========================================
exports.searchWallpapers = async (req, res) => {
    const searchStartedAt = Date.now();
    try {
        const { q, exclude, type, premium, seed } = req.query;
        if (type !== undefined && !['all', 'image', 'video'].includes(type)) {
            return res.status(400).json({ msg: 'Elige todos, imágenes o videos.' });
        }

        // ── Validación de parámetros ──────────────────────────────────────────
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 16));
        const skip  = (page - 1) * limit;
        const paginated = req.query.pagination === 'cursor' || req.query.cursor !== undefined;
        const emptyResults = () => res.json(paginated ? { items: [], hasMore: false, nextCursor: null } : []);

        if (typeof q !== 'string' || !q.trim()) return emptyResults();
        
        // 1. Normalización e inferencia de formato "live"; las frases se resuelven antes de quitar stop words.
        const { text: cleanQuery, isLive } = cleanSearchQuery(q);
        if (!cleanQuery) return emptyResults();

        // Si la inferencia detecta live y el tipo no está definido o es 'all', forzamos type = 'video'
        let finalType = type;
        if (isLive && (!type || type === 'all')) {
            finalType = 'video';
        }
        const key = searchKey(cleanQuery, finalType, premium, exclude);
        const cursor = readSearchCursor(req.query.cursor, key);

        const concepts = await resolveSearchConcepts(cleanQuery, IGNORED_SEARCH_WORDS);
        if (!concepts.length) { return emptyResults(); }
        const rawSearch = concepts.map(concept => concept.original).join(' ');
        const canonicalQuery = concepts.map(concept => concept.canonical).join(' ');

        // Seed: debe ser finito y estar en rango [0, 1)
        const parsedSeed = parseFloat(seed);
        const randomSeed = cursor ? cursor.seed : Number.isFinite(parsedSeed) && parsedSeed >= 0 && parsedSeed < 1
            ? parsedSeed
            : Math.random();

        // Resolve spacing per concept, so adding an alias never drops a color/subject.
        const spacedTagsArrays = await Promise.all(concepts.map(concept => expandSpacedTags(concept.original)));
        concepts.forEach((concept, index) => {
            concept.alternatives = [...new Set([...concept.alternatives, ...spacedTagsArrays[index]]
                .flatMap(term => [term, term.replace(/[\s-]+/g, '')]))];
        });
        const exactTerms = [...new Set([rawSearch, canonicalQuery])];
        const expandedTerms = new Set([rawSearch, canonicalQuery, ...concepts.flatMap(concept => concept.alternatives)]);

        // ── Filtros base ──────────────────────────────────────────────────────
        const matchQuery = { status: 'approved' };
        if (finalType && finalType !== 'all') matchQuery.type = finalType;
        if (premium === 'true')     matchQuery.price = { $gt: 0 };

        if (exclude) {
            const ids = exclude
                .split(',')
                .slice(0, 100)
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            if (ids.length) matchQuery._id = { $nin: ids };
        }

        // Atlas validates equivalences and typos before pagination; scoring cannot
        // admit a wallpaper that only matches a generic word such as "anime".
        const buildSearchPipeline = (useFuzzy, { offset = paginated ? 0 : skip, take = paginated ? limit + 1 : limit } = {}) => {
            const shouldClauses = [];
            const termsArray = [...expandedTerms].filter(t => t && t.length >= 2);

            // Palabras originales ingresadas por el usuario (para limitar búsquedas sueltas de sinónimos)
            const originalWords = new Set(
                rawSearch.split(/\s+/)
                    .filter(w => w.length >= 2)
                    .map(w => w.toLowerCase().trim())
            );

            const wordFuzzy = word => searchWordFuzzy(word, useFuzzy);
            const requiredConcepts = requiredSearchConcepts(concepts, useFuzzy);

            for (const term of termsArray) {
                const variants = [term];
                if (term.includes(' ')) {
                    variants.push(term.replace(/\s+/g, ''));
                }
                if (term.includes('-')) {
                    variants.push(term.replace(/-/g, ''));
                }

                for (const variant of [...new Set(variants)]) {
                    if (variant.includes(' ')) {
                        // 1. Coincidencia exacta de la frase (Boost muy alto con score constante)
                        shouldClauses.push({
                            phrase: {
                                query: variant,
                                path: "tags",
                                score: { constant: { value: 10 } }
                            }
                        });

                        // 2. Coincidencia obligatoria de TODOS los términos del variante (AND con score constante)
                        const words = variant.split(/\s+/).filter(Boolean);
                        if (words.length > 1) {
                            const mustClauses = words.map(word => {
                                const textQuery = { query: word, path: SEARCH_TEXT_PATHS };
                                const fuzzyConf = wordFuzzy(word);
                                if (fuzzyConf) textQuery.fuzzy = fuzzyConf;
                                return { text: textQuery };
                            });
                            shouldClauses.push({
                                compound: {
                                    must: mustClauses,
                                    score: { constant: { value: 4 } }
                                }
                            });
                        }

                        // 3. Coincidencias sueltas individuales SOLO si la palabra estaba en la consulta original
                        words.forEach(word => {
                            if (word.length >= 2 && originalWords.has(word)) {
                                const fuzzyConf = wordFuzzy(word);
                                shouldClauses.push({
                                    text: {
                                        query: word,
                                        path: SEARCH_TEXT_PATHS,
                                        ...(fuzzyConf ? { fuzzy: fuzzyConf } : {}),
                                        score: { constant: { value: 2 } }
                                    }
                                });
                            }
                        });
                    } else {
                        // Términos de una sola palabra
                        const fuzzyConf = wordFuzzy(variant);
                        shouldClauses.push({
                            text: {
                                query: variant,
                                path: SEARCH_TEXT_PATHS,
                                ...(fuzzyConf ? { fuzzy: fuzzyConf } : {}),
                                score: { constant: { value: originalWords.has(variant) ? 2 : 1 } }
                            }
                        });
                    }
                }
            }

            if (shouldClauses.length === 0) {
                shouldClauses.push({ text: { query: rawSearch, path: SEARCH_TEXT_PATHS } });
            }
            // Descriptions supplement tags; they never remove a requested concept.
            shouldClauses.push({ text: { query: canonicalQuery, path: 'searchDescriptions', matchCriteria: 'all',
                score: { constant: { value: 3 } } } });
            const descriptionPhrases = new Set([rawSearch, canonicalQuery, ...concepts.map(concept => concept.canonical)]);
            for (const phrase of descriptionPhrases) {
                if (phrase.includes(' ')) {
                    shouldClauses.push({ phrase: { query: phrase, path: 'searchDescriptions', score: { constant: { value: 6 } } } });
                }
            }

            return [
                {
                    $search: {
                        index: "default",
                        compound: {
                            filter: requiredConcepts,
                            should: shouldClauses,
                            minimumShouldMatch: 1
                        }
                    }
                },
                { $addFields: { score: { $meta: 'searchScore' } } },
                { $match: matchQuery },
                {
                    // Aplicar boost de coincidencia exacta de etiquetas en la base de datos
                    $addFields: {
                        exactTagMatchBoost: {
                            $cond: {
                                if: {
                                    $gt: [
                                        {
                                            $size: {
                                                $setIntersection: [
                                                    { $map: { input: "$tags", as: "t", in: { $toLower: { $trim: { input: "$$t" } } } } },
                                                    exactTerms
                                                ]
                                            }
                                        },
                                        0
                                    ]
                                },
                                then: 15,
                                else: 0
                            }
                        }
                    }
                },
                {
                    $addFields: {
                        finalBaseScore: { $add: ["$score", "$exactTagMatchBoost"] }
                    }
                },
                { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
                { $unwind: '$artist' },
                { $match: { 'artist.isActive': { $ne: false } } },
                {
                    $addFields: {
                        randomizedScore: {
                            $multiply: [
                                '$finalBaseScore',
                                {
                                    $add: [
                                        1,
                                        {
                                            $divide: [
                                                {
                                                    $mod: [
                                                        {
                                                            $multiply: [
                                                                { $divide: [ { $toLong: { $toDate: "$_id" } }, 1000 ] },
                                                                Math.floor(randomSeed * 999983) || 123457
                                                            ]
                                                        },
                                                        997
                                                    ]
                                                },
                                                6646
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                },
                // Keep the existing ~15% variety, with a unique tie-breaker.
                ...(cursor ? [{ $match: { $or: [
                    { randomizedScore: { $lt: cursor.score } },
                    { randomizedScore: cursor.score, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
                ] } }] : []),
                { $sort : { randomizedScore: -1, _id: -1 } },
                { $skip : offset },
                { $limit: take },
                {
                    $project: {
                        score          : 0,
                        exactTagMatchBoost: 0,
                        finalBaseScore: 0,
                        searchDescriptions: 0,
                        // randomizedScore stays internal until the next cursor is built.
                        'artist.password' : 0,
                        'artist.email'    : 0,
                        'artist.pushToken': 0,
                    },
                },
            ];
        };

        // Exact matches/aliases first, then fuzzy with the same required concepts.
        // Never relax to a partial query: "anime narutoo" must still match Naruto.
        let mode = cursor?.mode ?? 'exact';
        let results = await Wallpaper.aggregate(buildSearchPipeline(mode === 'fuzzy'));
        if (!cursor && mode === 'exact' && results.length === 0) {
            // Legacy page clients must also keep the first page's search mode.
            const hasExactResults = !paginated && page > 1 &&
                (await Wallpaper.aggregate(buildSearchPipeline(false, { offset: 0, take: 1 }))).length > 0;
            if (!hasExactResults) {
                mode = 'fuzzy';
                results = await Wallpaper.aggregate(buildSearchPipeline(true));
            }
        }

        // Required concepts already filter relevance in Atlas. Never prune a page
        // after its limit: doing so hides valid matches and breaks continuation.
        const hasMore = paginated && results.length > limit;
        if (paginated) { results = results.slice(0, limit); }
        const nextCursor = hasMore ? nextSearchCursor(results[results.length - 1], key, randomSeed, mode) : null;

        // Only the first page represents a search; an empty next page is not unmet demand.
        if (!cursor && (paginated || page === 1)) {
            await recordSearch(req.query.searchId, rawSearch, results.length, {
                // Bump this identifier whenever retrieval or ranking changes.
                searchVersion: SEARCH_VERSION, searchMode: mode,
                mediaType: finalType || 'all',
                serverDurationMs: Math.max(0, Date.now() - searchStartedAt),
            }).catch(error => console.error('[analytics]', error.message));
            quietly(saveSearchLogAsync(canonicalQuery, results.length));
        }

        const items = results.map(item => {
            const cleanItem = { ...item, price: item.price ?? 0 };
            const matched = matchedAssetId(item, canonicalQuery);
            if (matched) { cleanItem.matchedAssetId = matched; }
            delete cleanItem.finalBaseScore;
            delete cleanItem.randomizedScore;
            return cleanItem;
        });
        return res.json(paginated ? { items, hasMore, nextCursor } : items);
         
    } catch (err) {
        if (err.statusCode === 400) { return res.status(400).json({ msg: err.message }); }
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
        const limit = parseInt(req.query.limit) || 12;
        const skip = (page - 1) * limit;
        const status = req.query.status || 'approved';

        if (!mongoose.Types.ObjectId.isValid(artistId)) {
            return res.status(400).json({ msg: 'ID de artista no válido' });
        }

        const artistObjId = new mongoose.Types.ObjectId(artistId);

        const matchQuery = { artist: artistObjId };
        if (status !== 'all') {
            matchQuery.status = status;
        }

        // Ejecutamos el conteo y la búsqueda en paralelo para ganar velocidad
        const [totalCount, wallpapers] = await Promise.all([
            Wallpaper.countDocuments(matchQuery),
            Wallpaper.find(matchQuery)
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
        const files = req.files || [];
        if (files.length === 0) return res.status(400).json({ msg: 'No se recibió media' });

        const isVideo = files[0].mimetype.startsWith('video');
        const user = await User.findById(req.user.id).lean();
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        const cleanupFiles = async (uploadedFiles) => {
            for (const file of uploadedFiles) {
                const fileIsVideo = file.mimetype.startsWith('video');
                const resourceType = fileIsVideo ? 'video' : 'image';
                const cloudinaryInstance = fileIsVideo ? cloudinarySecondary : cloudinaryPrimary;
                await cloudinaryInstance.uploader.destroy(file.filename, { resource_type: resourceType })
                    .catch(e => console.error('❌ Error limpiando archivo:', e));
            }
        };

        // 🛡️ REGLA A: BLOQUEO TOTAL PARA USUARIOS NO VERIFICADOS
        if (user.role !== 'admin' && !user.isVerified) {
            await cleanupFiles(files);
            return res.status(403).json({ 
                msg: 'Acceso restringido: Solo los Artistas Verificados pueden publicar en Vexel.' 
            });
        }

        // 🛡️ REGLA B: RESTRICCIÓN DE VIDEO (Solo para Admins)
        if (isVideo && user.role !== 'admin') {
            await cleanupFiles(files);
            return res.status(403).json({ msg: 'Solo el administrador puede subir Live Wallpapers.' });
        }

        // 2. Extraer datos del body
        const { tags, price, manualAIResult, useAI } = req.body; 
        if (files.some(file => file.mimetype.startsWith('video') !== isVideo)) {
            throw metadataError('Sube imágenes y videos en publicaciones separadas.');
        }
        if (tags !== undefined && (typeof tags !== 'string' || tags.length > 10000)) {
            throw metadataError('Las etiquetas deben ser texto separado por comas.');
        }
        if (useAI !== undefined && !['true', 'false'].includes(useAI)) { throw metadataError('La opción de IA no es válida.'); }
        if (manualAIResult !== undefined && (typeof manualAIResult !== 'string' || manualAIResult.length > 16000)) { throw metadataError('El JSON manual no es válido o es demasiado largo.'); }
        const metadata = req.body.metadata === undefined ? {} : parseMetadata(req.body.metadata);
        const assetMetadata = parseAssetMetadata(req.body.assetMetadata, files.length);
        let rawTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        let isAITagged = false;

        // 🚀 LÓGICA DE BYPASS: PROCESAR JSON MANUAL SI EXISTE
        if (manualAIResult && manualAIResult.trim() !== "") {
            try {
                const parsed = JSON.parse(manualAIResult);
                
                if (Array.isArray(parsed)) {
                    if (parsed.length > 20 || parsed.some(t => !t || typeof t.en !== 'string' || typeof t.es !== 'string' || !t.en.trim() || !t.es.trim() || t.en.length > 80 || t.es.length > 80 || /[\x00-\x1f]/.test(t.en + t.es))) {
                        throw metadataError('Cada etiqueta JSON debe tener en y es de hasta 80 caracteres.');
                    }
                    const manualEn = parsed.map(t => t.en.toLowerCase().trim());
                    // Spanish translations belong in the query dictionary, not the visible tags.
                    rawTags = [...new Set([...rawTags, ...manualEn])];

                    const tagMapOps = parsed
                        .filter(t => t.en && t.es && t.en !== t.es)
                        .map(({ en, es }) => ({
                            updateOne: {
                                filter: { original: normalizeTerm(es) },
                                update: { $set: { canonical: normalizeTerm(en), language: 'es' } },
                                upsert: true
                            }
                        }));
    
                    if (tagMapOps.length > 0) {
                        await TagMap.bulkWrite(tagMapOps, { ordered: false });
                    }

                    isAITagged = true;
                } else {
                    if (files.length !== 1) { throw metadataError('El JSON estructurado corresponde a una imagen. En carruseles usa los campos de cada imagen.'); }
                    assetMetadata[0] = { ...parseMetadata(parsed), ...assetMetadata[0] };
                    isAITagged = true;
                }
            } catch (jsonErr) { 
                throw jsonErr.statusCode ? jsonErr : metadataError('El JSON manual no es válido.');
            }
        }

        // 3. Limpieza y normalización de etiquetas finales
        const cleaned = cleanTags(rawTags);
        const finalTags = await resolveTagsArray(cleaned);

        // 4. Crear registro en DB
        const firstFile = files[0];
        const requestAI = !isVideo && !isAITagged && useAI === 'true';
        const imagesList = files.map((file, index) => ({
            assetId: randomUUID(),
            imageUrl: file.path,
            public_id: file.filename,
            metadata: assetMetadata[index],
            analysis: { status: requestAI ? 'pending' : 'not_requested' },
        }));

        const newWallpaper = new Wallpaper({
            ...(req.uploadRequestId ? { uploadRequestId: req.uploadRequestId } : {}),
            tags:      searchTagsFor({ manualTags: finalTags, metadata, images: imagesList }),
            searchDescriptions: searchDescriptionsFor({ metadata, images: imagesList }),
            manualTags: finalTags,
            metadata,
            metadataVersion: 1,
            imageUrl:  firstFile.path,
            public_id: firstFile.filename,
            images:    imagesList,
            artist:    req.user.id, 
            type:      isVideo ? 'video' : 'image',
            status:    'pending',
            isAITagged: isAITagged,
            price:     user.role === 'admin' ? Math.max(0, Number(price) || 0) : 0
        });

        await newWallpaper.save();
        await User.findByIdAndUpdate(req.user.id, { $inc: { wallpaperCount: 1 } })
            .catch(error => console.error('Error actualizando contador de wallpapers:', error.message));

        res.json(newWallpaper);

        // 🤖 LÓGICA DE DECISIÓN DE IA
        if (requestAI) {
            await aiQueue.addJobs(newWallpaper);
        }

    } catch (err) {
        console.error('❌ ERROR EN UPLOAD:', err);
        // A post-response AI error must never delete an already saved wallpaper.
        if (res.headersSent) return;

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileIsVideo = file.mimetype.startsWith('video');
                const resourceType = fileIsVideo ? 'video' : 'image';
                const cloudinaryInstance = fileIsVideo ? cloudinarySecondary : cloudinaryPrimary;
                await cloudinaryInstance.uploader.destroy(file.filename, { resource_type: resourceType })
                    .catch(e => console.error('❌ Error en limpieza post-error:', e));
            }
        }

        if (err.code === 11000 && req.uploadRequestId) {
            const existing = await Wallpaper.findOne({ artist: req.user.id, uploadRequestId: req.uploadRequestId }).lean();
            if (existing) return res.json(existing);
        }
        res.status(err.statusCode || 500).json({ msg: err.statusCode === 400 ? err.message : 'Error interno en la subida' });
    }
};


// ==========================================
// 🔍 FUNCIÓN 6: OBTENER RELACIONADOS (INFINITOS)
// ==========================================
exports.getRelatedWallpapers = async (req, res) => {
    try {
        const { id } = req.params;
        const primaryTag = typeof req.query.primaryTag === 'string'
            ? req.query.primaryTag.trim().toLowerCase()
            : '';
        const page     = Math.max(1, parseInt(req.query.page)  || 1);
        const limit    = Math.max(1, Math.min(50, parseInt(req.query.limit) || 12));
        const skip     = (page - 1) * limit;
        const rankingVersion = 2;
        const parsedSeed = typeof req.query.seed === 'string' ? Number(req.query.seed) : NaN;
        const hasSeed = req.query.seed !== '' && Number.isFinite(parsedSeed) && parsedSeed >= 0 && parsedSeed < 1;
        const randomMultiplier = hasSeed ? Math.floor(parsedSeed * 16777212) + 1 : 1;

        // ── 1. CACHE solo para página 1 y cuando no hay una etiqueta de prioridad ──
        if (page === 1 && !primaryTag && !hasSeed) {
            const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

            const cache = await RelatedCache.findOne({ wallpaperId: id });

            const isFresh =
                cache &&
                cache.rankingVersion === rankingVersion &&
                cache.limit === limit &&
                cache.snapshot?.length > 0 &&
                Date.now() - cache.updatedAt < CACHE_TTL_MS;

            if (isFresh) {
                return res.json(cache.snapshot); // snapshot ya tiene el formato final
            }
        }

        // ── 2. VALIDAR que el wallpaper original existe ──────────────────────
        const original = await Wallpaper.findById(id).lean();
        if (!original || !original.tags?.length) return res.json([]);

        const originalTags = [...new Set(original.tags)];
        // ponytail: la frecuencia aproxima la especificidad sin mantener listas de personajes.
        // Si se necesita distinguir personaje de estilo, añadir ese dato al etiquetado.
        const tagCounts = await Wallpaper.aggregate([
            { $match: { status: 'approved', tags: { $in: originalTags } } },
            { $project: { tags: { $setIntersection: ['$tags', originalTags] } } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
        ]);
        const tagWeights = originalTags.map(tag => ({
            tag,
            weight: 1 / Math.max(1, tagCounts.find(entry => entry._id === tag)?.count || 1),
        }));

        // ── 3. AGGREGATE unificado (mismo formato siempre) ───────────────────
        //    Índice recomendado: { status:1, tags:1, createdAt:-1 }
        const results = await Wallpaper.aggregate([
            {
                $match: {
                    status : 'approved',
                    _id    : { $ne: original._id },
                    tags   : { $in: originalTags },
                },
            },
            {
                $addFields: {
                    // La búsqueda solo desempata; el wallpaper seleccionado define el tema.
                    primaryTagMatches: primaryTag
                        ? { $cond: [{ $in: [primaryTag, '$tags'] }, 1, 0] }
                        : 0,
                    strongestTagWeight: {
                        $max: tagWeights.map(({ tag, weight }) => (
                            { $cond: [{ $in: [tag, '$tags'] }, weight, 0] }
                        )),
                    },
                    weightedTags: {
                        $sum: tagWeights.map(({ tag, weight }) => (
                            { $cond: [{ $in: [tag, '$tags'] }, weight, 0] }
                        )),
                    },
                    commonTags: {
                        $size: { $setIntersection: ['$tags', originalTags] },
                    },
                    // Misma semilla en todas las páginas; un nuevo detalle puede variar los empates.
                    relatedRandomOrder: hasSeed ? {
                        $mod: [
                            { $multiply: [
                                { $reduce: {
                                    input: { $range: [0, 24] },
                                    initialValue: 0,
                                    in: { $mod: [
                                        { $add: [
                                            { $multiply: ['$$value', 31] },
                                            { $indexOfBytes: ['0123456789abcdef', {
                                                $substrBytes: [{ $toString: '$_id' }, '$$this', 1],
                                            }] },
                                        ] },
                                        16777213,
                                    ] },
                                } },
                                randomMultiplier,
                            ] },
                            16777213,
                        ],
                    } : 0,
                },
            },
            { 
                $sort: { strongestTagWeight: -1, weightedTags: -1, commonTags: -1,
                    primaryTagMatches: -1, relatedRandomOrder: -1, createdAt: -1, _id: -1 }
            },
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
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    'artist.password' : 0,
                    'artist.email'    : 0,
                    commonTags        : 0, // campo auxiliar, no necesario en respuesta
                    primaryTagMatches : 0,
                    strongestTagWeight: 0,
                    weightedTags: 0,
                    relatedRandomOrder: 0,
                },
            },
        ]);

        // ── 4. GUARDAR cache solo en página 1 y cuando no hay una etiqueta de prioridad ──
        if (page === 1 && !primaryTag && !hasSeed && results.length > 0) {
            // Guardamos el snapshot completo (no solo IDs) → respuesta idéntica
            RelatedCache.findOneAndUpdate(
                { wallpaperId: id },
                { snapshot: results, updatedAt: new Date(), rankingVersion, limit },
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
            select: 'imageUrl title type tags category artist price images',
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
// 🏷️ OBTENER ETIQUETAS POPULARES (Con fallback en servidor)
// ==========================================
exports.getPopularTags = async (req, res) => {
    try {
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 50)
            : 30;

        const DEFAULT_POPULAR_TAGS = [
            'anime',
            'cyberpunk',
            'neon',
            'gaming',
            'minimalist',
            'cars',
            'space'
          ];

        const excludedTags = ['espacio', 'autos', 'abstracto', 'otros', 'live', 'general', '', ' '];

        // Consulta optimizada a la colección pre-calculada
        const result = await TagSuggestion.find(
            {
                tag: {
                    $nin: excludedTags,
                    $regex: /^[a-z0-9 ]+$/
                }
            },
            { tag: 1, _id: 0 }
        )
        .sort({ count: -1 })
        .limit(limit)
        .lean();

        let tagsOnly = result.map(t => t.tag);

        // Si hay menos de 10 tags en la DB, completamos con los defaults
        const minFallbackCount = Math.min(10, limit);
        if (tagsOnly.length < minFallbackCount) {
            const added = new Set(tagsOnly);
            for (const tag of DEFAULT_POPULAR_TAGS) {
                if (!added.has(tag)) {
                    tagsOnly.push(tag);
                    added.add(tag);
                }
                if (tagsOnly.length >= minFallbackCount) break;
            }
        }

        res.setHeader('Cache-Control', 'public, max-age=900');
        return res.json(tagsOnly);
    } catch (err) {
        console.error('❌ Error al obtener etiquetas populares:', err);
        return res.status(500).json(['anime', 'cyberpunk', 'neon', 'gaming', 'minimalist', 'cars', 'space']);
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

            // Registro de engagement desde búsqueda
            const { q } = req.query;
            if (q && q.trim().length >= 2) {
                const searchTerms = q.trim().toLowerCase();
                const singular = searchTerms.includes(' ') ? searchTerms : nlp(searchTerms).nouns().toSingular().text().trim();
                const term = singular || searchTerms;
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                SearchLog.findOneAndUpdate(
                    { term, date: today },
                    { $inc: { likes: 1 } },
                    { upsert: true }
                ).catch(err => console.error("❌ [SearchLog] Error guardando click de like:", err.message));
            }
        }

        await wallpaper.save();

        if (!alreadyLiked) quietly(recordSearchOutcome(req.query.searchId, 'liked'));

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

        // ── REGISTRO DE DESCARGA DESDE BÚSQUEDA ──
        await recordDownload(wallpaper._id).catch(error => console.error('[analytics]', error.message));
        quietly(recordSearchOutcome(req.query.searchId, 'downloaded'));
        const { q } = req.query;
        if (q && q.trim().length >= 2) {
            const searchTerms = q.trim().toLowerCase();
            const singular = searchTerms.includes(' ') ? searchTerms : nlp(searchTerms).nouns().toSingular().text().trim();
            const term = singular || searchTerms;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            SearchLog.findOneAndUpdate(
                { term, date: today },
                { $inc: { downloads: 1 } },
                { upsert: true }
            ).catch(err => console.error("❌ [SearchLog] Error guardando descarga de búsqueda:", err.message));
        }

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
        if (validDeviceId(deviceId)) {
            await recordActivity(deviceId).catch(error => console.error('[analytics]', error.message));
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
        if (wallpaper.images && wallpaper.images.length > 0) {
            for (const img of wallpaper.images) {
                if (img.public_id) {
                    const cloudinaryInstance = wallpaper.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
                    await cloudinaryInstance.uploader.destroy(img.public_id, {
                        resource_type: wallpaper.type === 'video' ? 'video' : 'image'
                    }).catch(e => console.error('Error deleting image from Cloudinary:', e));
                }
            }
        } else if (wallpaper.public_id) {
            const cloudinaryInstance = wallpaper.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
            await cloudinaryInstance.uploader.destroy(wallpaper.public_id, {
                resource_type: wallpaper.type === 'video' ? 'video' : 'image'
            }).catch(e => console.error('Error deleting image from Cloudinary:', e));
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

        const existing = await Wallpaper.findById(id).lean();
        if (!existing) { return res.status(404).json({ msg: 'Wallpaper no encontrado' }); }
        const result = existing.metadataVersion === 1
            ? await updateMetadata(id, current => removeMetadataTag(current, tagToRemove))
            : await Wallpaper.findByIdAndUpdate(id, { $pull: { tags: tagToRemove.trim().toLowerCase() } }, { new: true });

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

// ==========================================
// 🛠️ ADMIN: AGREGAR ETIQUETA ESPECÍFICA
// ==========================================
exports.adminAddTag = async (req, res) => {
    try {
        const { id } = req.params;
        const { tagToAdd } = req.body;
        const adminUser = await User.findById(req.user.id);

        if (!tagToAdd || typeof tagToAdd !== 'string') {
            return res.status(400).json({ msg: 'Etiqueta inválida' });
        }

        if (!adminUser || adminUser.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado: Se requiere rol de Admin' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID inválido' });
        }

        // Limpiar y normalizar el tag usando el flujo de tags
        const cleaned = cleanTags([tagToAdd]);
        if (cleaned.length === 0) {
            return res.status(400).json({ msg: 'La etiqueta no es válida o está en la lista negra (ej. calidad/relleno)' });
        }

        const resolved = await resolveTagsArray(cleaned);
        const finalTag = resolved[0];

        if (!finalTag) {
            return res.status(400).json({ msg: 'No se pudo procesar la etiqueta' });
        }

        const wallpaper = await Wallpaper.findById(id);
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        if (wallpaper.tags.includes(finalTag)) {
            return res.status(400).json({ msg: 'El wallpaper ya tiene esta etiqueta' });
        }

        // Agregar tag al array
        const result = wallpaper.metadataVersion === 1
            ? await updateMetadata(id, current => ({ manualTags: [...new Set([...(current.manualTags || []), finalTag])] }))
            : await Wallpaper.findByIdAndUpdate(id, { $addToSet: { tags: finalTag } }, { new: true });

        // Incrementar el contador en TagSuggestion
        await TagSuggestion.updateOne(
            { tag: finalTag },
            { $inc: { count: 1 } },
            { upsert: true }
        );

        return res.json({ msg: 'Etiqueta agregada', tags: result.tags });

    } catch (err) {
        console.error('❌ Error en adminAddTag:', err);
        return res.status(500).json({ msg: 'Error al agregar etiqueta' });
    }
};

// ── ENDPOINTS DE BANNER DESTACADO (SPOTLIGHT) ──

// GET /api/wallpapers/spotlight
exports.getSpotlights = async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const spotlights = await Spotlight.find({ createdAt: { $gte: twentyFourHoursAgo } })
            .populate({
                path: 'wallpaperId',
                populate: { path: 'artist', select: 'username profilePic isVerified' }
            })
            .sort({ createdAt: -1 });

        // Filtrar destacados donde el wallpaper exista y esté aprobado
        const validSpotlights = spotlights.filter(s => s.wallpaperId && s.wallpaperId.status === 'approved');
        
        return res.json(validSpotlights);
    } catch (err) {
        console.error('❌ Error en getSpotlights:', err);
        return res.status(500).json({ msg: 'Error al obtener banners destacados' });
    }
};

// POST /api/wallpapers/admin/spotlight
exports.addSpotlight = async (req, res) => {
    try {
        const { wallpaperId, title, subtitle } = req.body;
        if (!wallpaperId || !title) {
            return res.status(400).json({ msg: 'Faltan campos requeridos: wallpaperId y title' });
        }

        const wallpaper = await Wallpaper.findById(wallpaperId);
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        const newSpotlight = new Spotlight({
            wallpaperId,
            title: title.trim(),
            subtitle: subtitle ? subtitle.trim() : ''
        });

        await newSpotlight.save();
        return res.status(201).json(newSpotlight);
    } catch (err) {
        console.error('❌ Error en addSpotlight:', err);
        return res.status(500).json({ msg: 'Error al agregar banner destacado' });
    }
};

// DELETE /api/wallpapers/admin/spotlight/:id
exports.deleteSpotlight = async (req, res) => {
    try {
        const spotlight = await Spotlight.findById(req.params.id);
        if (!spotlight) {
            return res.status(404).json({ msg: 'Banner destacado no encontrado' });
        }

        await Spotlight.findByIdAndDelete(req.params.id);
        return res.json({ msg: 'Banner destacado eliminado correctamente' });
    } catch (err) {
        console.error('❌ Error en deleteSpotlight:', err);
        return res.status(500).json({ msg: 'Error al eliminar banner destacado' });
    }
};

// ── ENDPOINTS DE BURBUJAS FLOTANTES (FLOATING BUBBLES) ──

// GET /api/wallpapers/floating-bubbles
exports.getFloatingBubbles = async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');

        const bubbles = await FloatingBubble.find()
            .populate({
                path: 'wallpaperId',
                populate: { path: 'artist', select: 'username profilePic isVerified' }
            })
            .sort({ createdAt: -1 });

        // Filtrar burbujas donde el wallpaper exista y esté aprobado
        const validBubbles = bubbles.filter(b => b.wallpaperId && b.wallpaperId.status === 'approved');
        
        // Obtener etiquetas de wallpapers subidos en los últimos 3 días (72 horas)
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const recentTags = await Wallpaper.find({
            status: 'approved',
            createdAt: { $gte: threeDaysAgo }
        }).distinct('tags');

        const recentTagsLower = recentTags.map(t => t.toLowerCase().trim());

        // Asignar flag hasNewContent si el título de la burbuja coincide con una etiqueta reciente
        const bubblesWithNewFlag = validBubbles.map(bubble => {
            const bubbleTag = bubble.title.toLowerCase().trim();
            const hasNewContent = recentTagsLower.includes(bubbleTag);
            
            const bubbleObj = bubble.toObject();
            bubbleObj.hasNewContent = hasNewContent;
            return bubbleObj;
        });
        
        return res.json(bubblesWithNewFlag);
    } catch (err) {
        console.error('❌ Error en getFloatingBubbles:', err);
        return res.status(500).json({ msg: 'Error al obtener burbujas flotantes' });
    }
};

// POST /api/wallpapers/admin/floating-bubbles
exports.addFloatingBubble = async (req, res) => {
    try {
        const { wallpaperId, title } = req.body;
        if (!wallpaperId || !title) {
            return res.status(400).json({ msg: 'Faltan campos requeridos: wallpaperId y title' });
        }

        const wallpaper = await Wallpaper.findById(wallpaperId);
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        const newBubble = new FloatingBubble({
            wallpaperId,
            title: title.trim()
        });

        await newBubble.save();
        return res.status(201).json(newBubble);
    } catch (err) {
        console.error('❌ Error en addFloatingBubble:', err);
        return res.status(500).json({ msg: 'Error al agregar burbuja flotante' });
    }
};

// DELETE /api/wallpapers/admin/floating-bubbles/:id
exports.deleteFloatingBubble = async (req, res) => {
    try {
        const bubble = await FloatingBubble.findById(req.params.id);
        if (!bubble) {
            return res.status(404).json({ msg: 'Burbuja flotante no encontrada' });
        }

        await FloatingBubble.findByIdAndDelete(req.params.id);
        return res.json({ msg: 'Burbuja flotante eliminada correctamente' });
    } catch (err) {
        console.error('❌ Error en deleteFloatingBubble:', err);
        return res.status(500).json({ msg: 'Error al eliminar burbuja flotante' });
    }
};

// ==========================================
// 🛠️ ADMIN: FUSIONAR WALLPAPERS (LOTES)
// ==========================================
exports.mergeWallpapers = async (req, res) => {
    try {
        const { primaryId, secondaryId } = req.body;

        if (!primaryId || !secondaryId) {
            return res.status(400).json({ msg: 'Faltan campos requeridos: primaryId y secondaryId' });
        }

        if (primaryId === secondaryId) {
            return res.status(400).json({ msg: 'No se puede fusionar un wallpaper consigo mismo' });
        }

        if (!mongoose.Types.ObjectId.isValid(primaryId) || !mongoose.Types.ObjectId.isValid(secondaryId)) {
            return res.status(400).json({ msg: 'IDs inválidos' });
        }

        const merged = await mergeWithMetadata(primaryId, secondaryId);
        return res.json({ msg: 'Wallpapers fusionados con éxito', wallpaper: merged });
    } catch (err) {
        console.error('❌ Error en mergeWallpapers:', err);
        return res.status(err.statusCode || 500).json({ msg: err.statusCode ? err.message : 'Error al fusionar wallpapers' });
    }
};
