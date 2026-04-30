const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const Visitor = require('../models/Visitor');
const Feedback = require('../models/Feedback');
const { Expo } = require('expo-server-sdk');
const { cloudinary } = require('../config/cloudinary');
const { getAITags } = require('../services/aiService');
const TagMap = require('../models/TagMap');
const SearchLog = require('../models/SearchLog'); 

let expo = new Expo();

// 1. ENVIAR NOTIFICACIÓN GLOBAL (SOLO ADMIN) 
exports.broadcast = async (req, res) => {
    const { title, body } = req.body;

    try {
        // OBTENER TOKENS ÚNICOS (Solución al bug de duplicados)
        const uniqueTokens = await User.distinct('pushToken', { 
            pushToken: { $ne: "", $exists: true } 
        });

        if (uniqueTokens.length === 0) {
            return res.status(400).json({ msg: 'No hay dispositivos registrados para recibir notificaciones' });
        }

        // Preparar los mensajes para Expo
        let messages = [];
        for (let token of uniqueTokens) {
            if (Expo.isExpoPushToken(token)) {
                messages.push({
                    to: token,
                    sound: 'default',
                    title: title || '✨ ¡Nuevos Wallpapers!',
                    body: body || 'Hemos subido arte nuevo. ¡Entra a descubrirlo!',
                    data: { screen: 'Explorar' },
                    priority: 'high',
                    channelId: 'default', 
                });
            } else {
                console.log(`Token detectado como inválido: ${token}`);
            }
        }

        // Envío por lotes (Chunks) para evitar bloqueos de red
        let chunks = expo.chunkPushNotifications(messages); 
        let tickets = [];
        
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error("Error al enviar un lote de notificaciones:", error);
            }
        }

        // Respuesta detallada tal como la tenías
        res.json({ 
            msg: `Proceso completado con éxito`, 
            dispositivosAlcanzados: uniqueTokens.length,
            mensajesProcesados: messages.length 
        });

    } catch (err) {
        console.error("Error crítico en la función broadcast:", err);
        res.status(500).send('Error interno del servidor al enviar notificaciones');
    }
};

// 2. TOGGLE VERIFICACIÓN (SOLO ADMIN)
exports.verifyUser = async (req, res) => {
    try {
        const userToVerify = await User.findById(req.params.userId);
        if (!userToVerify) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // Cambiamos el estado (si era false pasa a true y viceversa)
        userToVerify.isVerified = !userToVerify.isVerified;
        userToVerify.isVerificationPending = false; // <--- Importante para limpiar el estado
        await userToVerify.save();

        res.json({ 
            msg: `Usuario ${userToVerify.username} ${userToVerify.isVerified ? 'Verificado' : 'Sin Verificar'}`,
            isVerified: userToVerify.isVerified 
        });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
};

// 3. RECHAZAR VERIFICACIÓN (SOLO ADMIN)
exports.rejectVerification = async (req, res) => {
    try {
        const userToReject = await User.findById(req.params.userId);
        if (!userToReject) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // Quitamos el estado de pendiente para que pueda volver a solicitarlo en el futuro
        userToReject.isVerificationPending = false;
        await userToReject.save();

        res.json({ msg: `Solicitud de ${userToReject.username} rechazada.` });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
};


// 4. OBTENER REPORTES (Mantiene tu lógica de populate detallado)
exports.getReports = async (req, res) => {
    try {
        const reports = await Feedback.find()
            .populate('user', 'username email')
            .populate({
                path: 'targetWallpaper',
                select: 'imageUrl title public_id artist',
                populate: { path: 'artist', select: 'username' }
            })
            .sort({ createdAt: -1 });

        res.json(reports);
    } catch (err) { 
        res.status(500).send('Error al obtener reportes'); 
    }
};

// 5. ACCIÓN DEL ADMIN (Borrar contenido o descartar reporte)
exports.reportAction = async (req, res) => {
    const { reportId, action, wallpaperId } = req.body;
    
    try {
        if (action === 'delete_content') {
            const wall = await Wallpaper.findById(wallpaperId);
            
            if (wall) {
                // 1. Borramos de Cloudinary con detección de tipo (Imagen o Video)
                // Sin el resource_type, Cloudinary no borraría los archivos de video.
                if (wall.public_id) {
                    await cloudinary.uploader.destroy(wall.public_id, {
                        resource_type: wall.type === 'video' ? 'video' : 'image'
                    });
                }

                // 2. Restamos 1 al contador del artista
                await User.findByIdAndUpdate(wall.artist, { $inc: { wallpaperCount: -1 } });

                // 3. Borramos el registro de la Base de Datos
                await Wallpaper.findByIdAndDelete(wallpaperId);
            }

            // 4. Borramos el reporte de feedback
            await Feedback.findByIdAndDelete(reportId);
            
            return res.json({ msg: 'Contenido eliminado de la nube y contador actualizado' });
        } 
        
        if (action === 'dismiss_report') {
            // Solo borramos el reporte de la lista, el contenido se queda
            await Feedback.findByIdAndDelete(reportId);
            return res.json({ msg: 'Reporte descartado' });
        }

        res.status(400).json({ msg: 'Acción no válida' });

    } catch (err) {
        console.error("❌ Error en reportAction:", err);
        res.status(500).send('Error al procesar la acción del administrador');
    }
};


// REINTENTAR ETIQUETADO POR IA (SOLO ADMIN) - VERSIÓN INTELIGENTE
exports.retryAITagging = async (req, res) => {
    try {
        // 1. Buscar el wallpaper en la base de datos
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // Aseguramos que la URL use HTTPS para evitar problemas con la API de Google
        const secureUrl = wallpaper.imageUrl.replace('http://', 'https://');
        console.log(`♻️ [ADMIN] Reintento IA para: "${wallpaper.title}"`);

        // 2. Llamar al servicio de IA (Gemini)
        // Se espera un formato: [{ en: "city", es: "ciudad" }, ...]
        const aiTags = await getAITags(secureUrl);

        if (!aiTags || aiTags.length === 0) {
            return res.status(503).json({ 
                msg: 'La IA no pudo analizar la imagen. Espera 30 segundos y reintenta.' 
            });
        }

        // 3. Procesar y separar etiquetas por idioma
        const enTags = aiTags.map(t => t.en.toLowerCase().trim());
        const esTags = aiTags
            .map(t => t.es.toLowerCase().trim())
            .filter(es => !enTags.includes(es)); // Evitar duplicar si la palabra es igual en ambos idiomas

        // 4. Mezclar con las etiquetas que ya tenía el wallpaper (sin repetir)
        const currentTags = wallpaper.tags || [];
        const finalTags = [...new Set([...currentTags, ...enTags, ...esTags])];

        // 5. ACTUALIZAR DICCIONARIO (TagMap)
        // Esto permite que el sistema "aprenda" la traducción para futuras búsquedas
        const tagMapOps = aiTags
            .filter(t => t.en !== t.es) // Solo mapeamos si son palabras distintas (ej: ciudad -> city)
            .map(({ en, es }) => ({
                updateOne: {
                    filter: { original: es.toLowerCase().trim() },
                    update: { $set: { canonical: en.toLowerCase().trim(), language: 'es' } },
                    upsert: true
                }
            }));

        if (tagMapOps.length > 0) {
            // Operación masiva para no saturar la DB
            await TagMap.bulkWrite(tagMapOps, { ordered: false });
            console.log(`📚 [TAGMAP] ${tagMapOps.length} mapeos actualizados desde el panel admin`);
        }

        // 6. Guardar cambios en el Wallpaper
        wallpaper.tags = finalTags;
        wallpaper.isAITagged = true;
        await wallpaper.save();

        console.log(`✅ [ADMIN] ${finalTags.length} etiquetas actualizadas para "${wallpaper.title}"`);
        
        res.json({ 
            msg: 'IA procesada con éxito ✨', 
            tags: finalTags, 
            isAITagged: true 
        });

    } catch (err) {
        console.error("❌ Error crítico en retryAITagging:", err.message);
        res.status(500).json({ msg: 'Error interno al conectar con el servidor de IA' });
    }
};



// ============================================================
// HELPERS
// ============================================================
 
/**
 * Devuelve Date relativa a ahora.
 * @param {number} days - Días hacia atrás (puede ser fracción).
 */
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// ============================================================
// GET /api/admin/stats  →  getDashboardStats
// ============================================================
exports.getDashboardStats = async (req, res) => {
    try {
        const now       = new Date();
        const ago1day   = daysAgo(1);
        const ago3days  = daysAgo(3);
        const ago4days  = daysAgo(4);
        const ago7days  = daysAgo(7);

        const [
            totalUsers,
            newUsersWeek,
            dau,
            totalVisitors,
            newVisitorsWeek,
            totalWallpapers,
            pendingWallpapers,
            totalDownloadsAgg,
            totalLikesAgg, 
            statsByTag, 
            topSearches,
            cohort,
        ] = await Promise.all([
            // ── Usuarios ──────────────────────────────────────────
            User.countDocuments(),
            User.countDocuments({ createdAt: { $gte: ago7days } }),

            // ── Visitantes ────────────────────────────────────────
            Visitor.countDocuments({ lastActiveAt: { $gte: ago1day } }),
            Visitor.countDocuments(),
            Visitor.countDocuments({ createdAt: { $gte: ago7days } }),

            // ── Wallpapers ────────────────────────────────────────
            Wallpaper.countDocuments({ status: 'approved' }),
            Wallpaper.countDocuments({ status: 'pending' }),

            // ── Descargas totales ─────────────────────────────────
            Wallpaper.aggregate([
                { $group: { _id: null, total: { $sum: '$downloads' } } },
            ]),

            // ── Likes totales ─────────────────────────────────────
            Wallpaper.aggregate([
                { $project: { count: { $size: '$likes' } } },
                { $group: { _id: null, total: { $sum: '$count' } } },
            ]),

            // ── Top 15 etiquetas en galería ───────────────────────
            Wallpaper.aggregate([
                { $match: { status: 'approved' } },
                { $unwind: '$tags' },
                { $group: { _id: '$tags', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 15 },
            ]),

            // ── Top 10 búsquedas (solo las que superen umbral) ────
            SearchLog.find({ count: { $gte: 2 } })   // ← umbral mínimo
                .sort({ count: -1 })
                .limit(10)
                .select('term count -_id')
                .lean(),

            // ── Cohorte de retención (descargaron hace 3-4 días) ──
            Visitor.find({
                lastDownloadAt: { $gte: ago4days, $lte: ago3days },
            }).select('lastActiveAt').lean(),
        ]);

        // ── Tasa de retención ──────────────────────────────────────
        const cohortSize    = cohort.length;
        const retained      = cohort.filter(v => v.lastActiveAt >= ago1day).length;
        const retentionRate = cohortSize > 0
            ? +((retained / cohortSize) * 100).toFixed(1)
            : 0;

        return res.json({
            users: {
                total:           totalUsers,
                newWeek:         newUsersWeek,
                dau,
                totalVisitors,
                newVisitorsWeek,
            },
            content: {
                total:     totalWallpapers,
                pending:   pendingWallpapers,
                downloads: totalDownloadsAgg[0]?.total ?? 0,
                likes:     totalLikesAgg[0]?.total     ?? 0,
                retention: retentionRate,
            },
            tags:    statsByTag,
            searches: topSearches,
        });

    } catch (err) {
        console.error('[getDashboardStats]', err);
        return res.status(500).json({ msg: 'Error al generar estadísticas' });
    }
};

// ============================================================
// DELETE /api/admin/searches/cleanup  →  cleanupSearchLogs
// Elimina búsquedas con count <= minCount (default: 1)
// Query param: ?minCount=2  o  ?olderThanDays=30
// ============================================================
exports.cleanupSearchLogs = async (req, res) => {
    try {
        const minCount      = parseInt(req.query.minCount, 10)      || 1;
        const olderThanDays = parseInt(req.query.olderThanDays, 10) || null;

        // Construimos el filtro dinámicamente
        const filter = { count: { $lte: minCount } };

        if (olderThanDays) {
            filter.updatedAt = { $lte: daysAgo(olderThanDays) };
        }

        const { deletedCount } = await SearchLog.deleteMany(filter);

        return res.json({
            msg:     `Se eliminaron ${deletedCount} búsqueda(s) con count ≤ ${minCount}`,
            deleted: deletedCount,
        });

    } catch (err) {
        console.error('[cleanupSearchLogs]', err);
        return res.status(500).json({ msg: 'Error al limpiar búsquedas' });
    }
};

// ============================================================
// GET /api/admin/searches  →  getTopSearches
// Soporta: ?limit=20 &minCount=3 &page=1
// ============================================================
exports.getTopSearches = async (req, res) => {
    try {
        const limit    = Math.min(parseInt(req.query.limit, 10)    || 10, 100);
        const minCount = parseInt(req.query.minCount, 10) || 1;
        const page     = Math.max(parseInt(req.query.page, 10)     || 1, 1);
        const skip     = (page - 1) * limit;

        const [searches, total] = await Promise.all([
            SearchLog.find({ count: { $gte: minCount } })
                .sort({ count: -1 })
                .skip(skip)
                .limit(limit)
                .select('term count updatedAt -_id')
                .lean(),
            SearchLog.countDocuments({ count: { $gte: minCount } }),
        ]);

        return res.json({
            searches,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });

    } catch (err) {
        console.error('[getTopSearches]', err);
        return res.status(500).json({ msg: 'Error al obtener búsquedas' });
    }
};