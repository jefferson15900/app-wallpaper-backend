const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const Visitor = require('../models/Visitor');
const Feedback = require('../models/Feedback');
const { Expo } = require('expo-server-sdk');
const { cloudinaryPrimary, cloudinarySecondary } = require('../config/cloudinary');
const { getAITags } = require('../services/aiService');
const TagMap = require('../models/TagMap');
const SearchLog = require('../models/SearchLog'); 
const VerificationRequest = require('../models/VerificationRequest');
const VALID_ACTIONS = ['approved', 'rejected'];
const { incrementTagCounts } = require('../services/tagService');
const Broadcast = require('../models/Broadcast');

let expo = new Expo();

const broadcastView = campaign => ({
    ...(campaign.result || {}),
    requestId: campaign.requestId, title: campaign.title, body: campaign.body,
    mode: campaign.mode, status: campaign.status, createdAt: campaign.createdAt,
    msg: campaign.result?.msg || 'Envío iniciado. Consulta su estado antes de crear otro envío.',
});

exports.broadcastHistory = async (req, res) => {
    try {
        const campaigns = await Broadcast.find({ owner: req.user.id }).sort({ createdAt: -1 }).limit(10).lean();
        res.json({ campaigns: campaigns.map(broadcastView) });
    } catch (err) {
        res.status(500).json({ msg: 'No se pudo cargar el historial. Intenta de nuevo.' });
    }
};

exports.broadcastStatus = async (req, res) => {
    if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(req.params.requestId || '')) {
        return res.status(400).json({ msg: 'Identificador de envío inválido.' });
    }
    try {
        const campaign = await Broadcast.findOne({ owner: req.user.id, requestId: req.params.requestId }).lean();
        if (!campaign) return res.status(404).json({ msg: 'Este envío todavía no está registrado. Puedes recuperar el mismo intento sin duplicarlo.' });
        res.json(broadcastView(campaign));
    } catch (err) {
        res.status(500).json({ msg: 'No se pudo consultar el envío. Intenta de nuevo sin reenviarlo.' });
    }
};

// 1. ENVIAR NOTIFICACIÓN GLOBAL (SOLO ADMIN) 
exports.broadcast = async (req, res) => {
    const { title, body, requestId, mode = 'global' } = req.body || {};
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || !body.trim()) {
        return res.status(400).json({ msg: 'Completa el título y el contenido de la notificación' });
    }

    if (title.trim().length > 120 || body.trim().length > 500) {
        return res.status(400).json({ msg: 'Usa hasta 120 caracteres en el título y 500 en el mensaje.' });
    }
    if (!['global', 'test'].includes(mode) || (mode === 'test' && !requestId) ||
        (requestId !== undefined && (typeof requestId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId)))) {
        return res.status(400).json({ msg: 'El identificador o tipo de envío no es válido.' });
    }

    let campaign;
    try {
        if (requestId) {
            // The unique index claims the send atomically across requests and server instances.
            await Broadcast.init();
            try {
                campaign = await Broadcast.create({ owner: req.user.id, requestId, title: title.trim(), body: body.trim(), mode });
            } catch (error) {
                if (error.code !== 11000) throw error;
                const existing = await Broadcast.findOne({ owner: req.user.id, requestId }).lean();
                if (!existing || existing.title !== title.trim() || existing.body !== body.trim() || existing.mode !== mode) {
                    return res.status(409).json({ msg: 'Este identificador ya pertenece a otro mensaje. Consulta el historial.' });
                }
                return res.json(broadcastView(existing));
            }
        }
        const uniqueTokens = await User.distinct('pushToken', {
            pushToken: { $ne: "", $exists: true },
            ...(mode === 'test' ? { _id: req.user.id } : {}),
        });
        const validTokens = uniqueTokens.filter(token => Expo.isExpoPushToken(token));
        if (validTokens.length === 0) {
            const result = { msg: mode === 'test'
                ? 'Tu cuenta no tiene un dispositivo registrado. Abre la app instalada y permite las notificaciones.'
                : 'No hay dispositivos con un token de Expo válido. Abre la app instalada y permite las notificaciones.',
                accepted: 0, failed: 0, errors: {}, receiptIds: [] };
            if (campaign) { campaign.status = 'completed'; campaign.result = result; await campaign.save(); }
            return res.status(400).json(campaign ? broadcastView(campaign) : result);
        }
        const messages = validTokens.map(to => ({
            to, sound: 'default', title: title.trim(), body: body.trim(),
            data: { screen: 'Explorar' }, priority: 'high', channelId: 'default',
        }));
        const receiptIds = [];
        const errors = {};
        const staleTokens = [];
        let failed = 0;
        let unconfirmed = false;
        const checkpoint = async () => {
            if (!campaign) return;
            campaign.result = { msg: 'Envío iniciado. Consulta su estado antes de crear otro envío.',
                accepted: receiptIds.length, failed, invalidTokens: uniqueTokens.length - validTokens.length,
                errors: { ...errors }, receiptIds: [...receiptIds] };
            await campaign.save();
        };
        for (const chunk of expo.chunkPushNotifications(messages)) {
            let tickets;
            try {
                tickets = await expo.sendPushNotificationsAsync(chunk);
            } catch (error) {
                // A network failure can be ambiguous; do not resend this batch automatically.
                unconfirmed = true;
                failed += chunk.length;
                const code = error.code || 'ExpoRequestFailed';
                errors[code] = (errors[code] || 0) + chunk.length;
                console.error('[broadcast] Expo rechazó o no confirmó un lote:', code);
                await checkpoint();
                continue;
            }
            for (const [index, message] of chunk.entries()) {
                const ticket = tickets[index];
                if (ticket?.status === 'ok' && ticket.id) {
                    receiptIds.push(ticket.id);
                } else {
                    failed++;
                    if (!ticket || ticket.status !== 'error') unconfirmed = true;
                    const code = ticket?.details?.error || 'InvalidExpoTicket';
                    errors[code] = (errors[code] || 0) + 1;
                    if (code === 'DeviceNotRegistered') staleTokens.push(message.to);
                }
            }
            await checkpoint();
        }
        if (staleTokens.length) {
            await User.updateMany({ pushToken: { $in: staleTokens } }, { $set: { pushToken: '' } })
                .catch(() => console.error('[broadcast] No se pudieron limpiar los tokens vencidos'));
        }
        const accepted = receiptIds.length;
        const result = {
            msg: accepted > 0
                ? `Expo aceptó ${accepted} notificaciones; ${failed} envíos fallaron o no se confirmaron. La entrega está pendiente de comprobación.`
                : 'Expo no aceptó ninguna notificación. Revisa los errores del envío.',
            accepted, failed, invalidTokens: uniqueTokens.length - validTokens.length,
            errors, receiptIds,
            // Compatibility: these counts refer to acceptance by Expo, not delivery to phones.
            dispositivosAlcanzados: accepted, mensajesProcesados: messages.length,
        };
        if (campaign) { campaign.status = unconfirmed ? 'unknown' : 'completed'; campaign.result = result; await campaign.save(); }
        return res.status(accepted > 0 ? 200 : 502).json(campaign ? broadcastView(campaign) : result);
    } catch (err) {
        if (campaign) {
            campaign.status = 'unknown';
            campaign.result = { ...(campaign.result || {}), msg: 'No se pudo confirmar el resultado completo. Consulta este envío; crear otro podría repetir el aviso.' };
            await campaign.save().catch(() => {});
        }
        console.error('[broadcast] Error interno:', err.name);
        res.status(500).json(campaign ? broadcastView(campaign) : { msg: 'Error interno del servidor al enviar notificaciones' });
    }
};

// Tickets only confirm acceptance. Receipts confirm the handoff to FCM/APNs.
exports.broadcastReceipts = async (req, res) => {
    const { receiptIds } = req.body || {};
    if (!Array.isArray(receiptIds) || receiptIds.length === 0 || receiptIds.length > 1000 ||
        receiptIds.some(id => typeof id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))) {
        return res.status(400).json({ msg: 'Envía entre 1 y 1000 identificadores de recibos válidos' });
    }
    try {
        const ids = [...new Set(receiptIds)];
        let confirmed = 0, failed = 0, pending = 0;
        const errors = {};
        for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
            const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
            for (const id of chunk) {
                const receipt = receipts[id];
                if (!receipt) pending++;
                else if (receipt.status === 'ok') confirmed++;
                else {
                    failed++;
                    const code = receipt.details?.error || 'UnknownReceiptError';
                    errors[code] = (errors[code] || 0) + 1;
                }
            }
        }
        res.json({ confirmed, failed, pending, errors });
    } catch (err) {
        console.error('[broadcastReceipts] No se pudieron consultar los recibos:', err.code || err.name);
        res.status(502).json({ msg: 'No se pudo consultar la entrega en Expo. Intenta verificar de nuevo sin reenviar la notificación.' });
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
                    const cloudinaryInstance = wall.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
                    await cloudinaryInstance.uploader.destroy(wall.public_id, {
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
        }

        // 6. Guardar cambios en el Wallpaper
        wallpaper.tags = finalTags;
        wallpaper.isAITagged = true;
        await wallpaper.save();

        
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
            contentGaps,
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

            // ── Top 10 búsquedas (últimos 7 días) ──
            SearchLog.aggregate([
                { $match: { date: { $gte: ago7days } } },
                {
                    $group: {
                        _id: "$term",
                        count: { $sum: "$count" },
                        clicks: { $sum: "$clicks" },
                        downloads: { $sum: "$downloads" }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        term: "$_id",
                        count: 1,
                        clicks: 1,
                        downloads: 1,
                        _id: 0
                    }
                }
            ]),

            // ── Brechas de contenido (últimos 7 días, latest resultsCount === 0 y sin wallpapers aprobados actualmente) ──
            SearchLog.aggregate([
                { $match: { date: { $gte: ago7days } } },
                { $sort: { date: -1 } },
                {
                    $group: {
                        _id: "$term",
                        count: { $sum: "$count" },
                        latestResultsCount: { $first: "$resultsCount" }
                    }
                },
                { $match: { latestResultsCount: 0 } },
                {
                    $lookup: {
                        from: 'wallpapers',
                        let: { term: "$_id" },
                        pipeline: [
                            { 
                                $match: { 
                                    $expr: { 
                                        $and: [
                                            { $eq: ["$status", "approved"] },
                                            { $in: ["$$term", { $ifNull: ["$tags", []] }] }
                                        ]
                                    } 
                                } 
                            },
                            { $limit: 1 }
                        ],
                        as: 'matchingWallpapers'
                    }
                },
                { $match: { matchingWallpapers: { $size: 0 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        term: "$_id",
                        count: 1,
                        _id: 0
                    }
                }
            ]),

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
            contentGaps: contentGaps,
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
        const clearAll      = req.query.all === 'true';

        // Construimos el filtro dinámicamente
        let filter = {};
        if (clearAll) {
            filter = {};
        } else {
            filter = { count: { $lte: minCount } };
            if (olderThanDays) {
                filter.updatedAt = { $lte: daysAgo(olderThanDays) };
            }
        }

        const { deletedCount } = await SearchLog.deleteMany(filter);

        return res.json({
            msg:     clearAll ? 'Se vació el historial de búsquedas por completo' : `Se eliminaron ${deletedCount} búsqueda(s) con count ≤ ${minCount}`,
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
        const limit      = Math.min(parseInt(req.query.limit, 10) || 10, 100);
        const page       = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const skip       = (page - 1) * limit;
        const filterType = req.query.filter || 'all_time'; // 'all_time' | 'trending' | 'content_gaps'

        const matchStage = {};

        if (filterType === 'trending') {
            const ago7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            matchStage.date = { $gte: ago7days };
        } else if (filterType === 'content_gaps') {
            matchStage.resultsCount = 0;
            const ago30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            matchStage.date = { $gte: ago30days };
        }

        // Consulta de agregación usando $facet para paginar y contar en una sola llamada
        const [results] = await SearchLog.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: "$term",
                    count: { $sum: "$count" },
                    clicks: { $sum: "$clicks" },
                    downloads: { $sum: "$downloads" },
                    resultsCount: { $last: "$resultsCount" }
                }
            },
            { $sort: { count: -1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const total = results?.metadata[0]?.total || 0;
        const searches = results?.data?.map(item => ({
            term: item._id,
            count: item.count,
            clicks: item.clicks,
            downloads: item.downloads,
            resultsCount: item.resultsCount
        })) || [];

        return res.json({
            searches,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });

    } catch (err) {
        console.error('[getTopSearches]', err);
        return res.status(500).json({ msg: 'Error al obtener búsquedas' });
    }
};


// ==========================================
// 🆔 PENDIENTES DE APROBACION 
// ==========================================
exports.getPendingWallpapers = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado. No eres admin.' });

        const pending = await Wallpaper.find({ status: 'pending' })
            .populate('artist', 'username email');
        res.json(pending);
    } catch (err) {
        res.status(500).send('Error en el servidor al buscar pendientes');
    }
};


// APROBAR O RECHAZAR WALLPAPER 
exports.approveOrReject = async (req, res) => {
    const { action } = req.body;

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ msg: 'Acción inválida' });
    }

    let approvalApplied = false;
    try {
        // Verificación de rol — idealmente en middleware, no aquí
        const user = await User.findById(req.user.id).lean();
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado' });
        }

        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        // ── CASO A: RECHAZADO ─────────────────────────────────────────────────
        if (action === 'rejected') {
            const cloudinaryInstance = wallpaper.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
            const destroyPromise = wallpaper.public_id
                ? cloudinaryInstance.uploader.destroy(wallpaper.public_id, {
                    resource_type: wallpaper.type === 'video' ? 'video' : 'image',
                })
                : Promise.resolve();

            // Las tres operaciones no dependen entre sí → paralelo
            await Promise.all([
                destroyPromise,
                Wallpaper.findByIdAndDelete(req.params.id),
                User.findByIdAndUpdate(wallpaper.artist, { $inc: { wallpaperCount: -1 } }),
            ]);

            return res.json({ msg: 'Wallpaper eliminado de la nube y DB' });
        }

        // ── CASO B: APROBADO ──────────────────────────────────────────────────
        // Un solo update, { new: true } para tener el doc actualizado
        const approved = await Wallpaper.findOneAndUpdate(
            { _id: req.params.id, status: 'pending' },
            { $set: { status: 'approved' } },
            { new: true }
        );
        if (!approved) return res.status(409).json({ msg: 'Este wallpaper ya no está pendiente de revisión.' });
        approvalApplied = true;

        // Wait for tag updates before the client processes the next approval.
        await incrementTagCounts(approved.tags).catch(err =>
            console.error('❌ Error incrementando tags:', err)
        );

        // Notificaciones
        const artist = await User.findById(wallpaper.artist)
            .populate('followers', 'pushToken username');

        if (!artist) return res.json({ msg: 'Wallpaper aprobado (artista no encontrado)' });

        const messages = [];

        // 1. Al artista
        if (artist.pushToken && Expo.isExpoPushToken(artist.pushToken)) {
            messages.push({
                to   : artist.pushToken,
                sound: 'default',
                title: '¡Obra Publicada! 🎨',
                body : 'Tu arte ya está disponible para toda la comunidad.',
                data : { screen: 'Profile' },
            });
        }

        // 2. A seguidores (cooldown 10 min)
        const DIEZ_MINUTOS = 10 * 60 * 1000;
        const ahora        = new Date();
        const ultimaVez    = artist.lastNotificationSentAt
            ? new Date(artist.lastNotificationSentAt)
            : null;

        const pasoCooldown = !ultimaVez || (ahora - ultimaVez) > DIEZ_MINUTOS;

        if (pasoCooldown && artist.followers?.length) {
            for (const follower of artist.followers) {
                if (follower.pushToken && Expo.isExpoPushToken(follower.pushToken)) {
                    messages.push({
                        to   : follower.pushToken,
                        sound: 'default',
                        title: '¡Nuevo arte disponible! ✨',
                        body : `${artist.username} acaba de subir un nuevo wallpaper.`,
                        data : { artistId: artist._id },
                    });
                }
            }

            artist.lastNotificationSentAt = ahora;
            await artist.save();
        }

        // Envío chunked — awaiteado para saber si falló
        if (messages.length > 0) {
            const chunks = expo.chunkPushNotifications(messages);
            for (const chunk of chunks) {
                try {
                    await expo.sendPushNotificationsAsync(chunk);
                } catch (err) {
                    console.error(`❌ Error enviando chunk de ${chunk.length} notificaciones:`, err);
                }
            }
        }

        return res.json({ msg: 'Wallpaper aprobado con éxito' });

    } catch (err) {
        console.error('❌ Error en approveOrReject:', err);
        // Publication is already committed; ancillary failures must not invite a duplicate retry.
        if (approvalApplied) return res.json({ msg: 'Wallpaper aprobado; no se pudieron completar las notificaciones.' });
        return res.status(500).json({ msg: 'Error interno en la decisión' });
    }
};

// --- MARCAR PREMIUM ---
exports.togglePremium = async (req, res) => {
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
};


// ==========================================
// SOLICITUD DE ARTISTA 
// ==========================================
exports.submitVerification = async (req, res) => {
    try {
        // 1. Desestructuramos todo desde req.body de una vez
        const { instagram, portfolio, artTypes,description  } = req.body;

        // 2. Validación de archivos movida aquí (o mejor aún, en middleware aparte)
        if (!req.files || req.files.length < 4) {
            return res.status(400).json({ 
                msg: 'Debes subir 4 imágenes de muestra.' 
            });
        }

        // 3. Parseamos artTypes de forma segura
        let parsedArtTypes = [];
        if (artTypes) {
            try {
                parsedArtTypes = JSON.parse(artTypes);
            } catch {
                return res.status(400).json({ msg: 'artTypes tiene un formato inválido.' });
            }
        }

        const sampleImages = req.files.map(file => ({
            url: file.path,
            public_id: file.filename
        }));

        // 4. Sin claves duplicadas
        const newRequest = new VerificationRequest({
            userId: req.user.id,
            instagram,
            portfolio,
            description,
            artTypes: parsedArtTypes,
            samples: sampleImages,
        });

        await newRequest.save();

        // 5. Actualizamos el usuario solo después de guardar exitosamente
        await User.findByIdAndUpdate(
            req.user.id, 
            { isVerificationPending: true },
            { new: true }
        );

        res.json({ msg: 'Solicitud enviada. Revisaremos tu talento pronto.' });

    } catch (err) {
        // 6. Logging real del error (usa tu logger en prod, no console.error)
        console.error('[submitVerification]', err);
        res.status(500).json({ msg: 'Error al procesar solicitud' });
    }
};

// ==========================================
// APROBAR/RECHAZAR ARTISTA
// ==========================================
exports.resolveVerification = async (req, res) => {
    try {
        const { requestId, action } = req.body;

        // 1. Validar action antes de tocar la BD
        if (!VALID_ACTIONS.includes(action)) {
            return res.status(400).json({ msg: 'Acción inválida. Usa: approved | rejected' });
        }

        const request = await VerificationRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ msg: 'Solicitud no encontrada' });
        }

        // 2. Actualizar usuario
        // ✅ FIJATE AQUÍ: Agregamos "const updatedUser =" para capturar el resultado
        const updatedUser = await User.findByIdAndUpdate(request.userId, {
            isVerified: action === 'approved',
            isVerificationPending: false,
            verificationStatus: action,
        }, { new: true });

        // Ahora esta validación ya NO dará error
        if (!updatedUser) {
            console.warn(`[resolveVerification] El usuario ${request.userId} ya no existe.`);
            await VerificationRequest.findByIdAndDelete(requestId);
            return res.status(404).json({ msg: 'El usuario ya no existe' });
        }

        // 3. Borrar imágenes en paralelo
        const deleteResults = await Promise.allSettled(
            request.samples.map(img => cloudinaryPrimary.uploader.destroy(img.public_id))
        );

        // Loguear los que fallaron sin romper el flujo
        deleteResults.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(
                    `[resolveVerification] No se pudo borrar imagen ${request.samples[i].public_id}:`,
                    result.reason
                );
            }
        });

        // 4. Borrar el registro de la solicitud
        await VerificationRequest.findByIdAndDelete(requestId);

        res.json({ msg: `Verificación ${action} procesada correctamente.` });

    } catch (err) {
        console.error('[resolveVerification]', err);
        res.status(500).json({ msg: 'Error al procesar la verificación' });
    }
};


// 🧹 EXTRA: Limpiar el estado de alerta del usuario (Se llama desde el Home tras ver la alerta)
exports.clearVerificationNotification = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id, 
            { $set: { verificationStatus: null } },
            { new: true }
        );

        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        res.sendStatus(200);
    } catch (e) {
        console.error('[clearVerificationNotification]', e);
        res.sendStatus(500);
    }
};


// 🛠️ OBTENER TODAS LAS SOLICITUDES DE VERIFICACIÓN
exports.getVerificationRequests = async (req, res) => {
    try {
        const requests = await VerificationRequest.find()
            .populate('userId', 'username profilePic email')
            .sort({ createdAt: -1 })
            .lean();

        res.json(requests);
    } catch (err) {
        console.error('[getVerificationRequests]', err);
        res.status(500).json({ msg: 'Error al obtener solicitudes' });
    }
};
