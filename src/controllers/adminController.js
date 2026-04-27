const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const Visitor = require('../models/Visitor');
const Feedback = require('../models/Feedback');
const { Expo } = require('expo-server-sdk');
const { cloudinary } = require('../config/cloudinary');
const { getAITags } = require('../services/aiService');
const TagMap = require('../models/TagMap');

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
        const wallpaper = await Wallpaper.findById(req.params.id);
        if (!wallpaper) return res.status(404).json({ msg: 'Wallpaper no encontrado' });

        const secureUrl = wallpaper.imageUrl.replace('http://', 'https://');
        console.log(`♻️ [ADMIN] Reintento IA para: "${wallpaper.title}"`);

        // aiTags ahora devuelve: [{ en, es, category }, ...]
        const aiTags = await getAITags(secureUrl);

        if (!aiTags || aiTags.length === 0) {
            return res.status(503).json({ 
                msg: 'La IA no pudo analizar la imagen. Espera 30 segundos y reintenta.' 
            });
        }

        // ── 1. DETERMINAR CATEGORÍA DOMINANTE ──────────────────────────
        const categoryCounts = {};
        aiTags.forEach(t => {
            if (t.category) {
                categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
            }
        });

        const dominantCategory = Object.keys(categoryCounts).length > 0
            ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
            : null;

        // ── 2. PREPARAR TAGS (UNIFICACIÓN) ──────────────────────────────
        const enTags = aiTags.map(t => t.en.toLowerCase().trim());
        const esTags = aiTags.map(t => t.es.toLowerCase().trim());

        const currentTags = wallpaper.tags || [];
        // Combinamos todo y eliminamos duplicados
        const finalTags = [...new Set([...currentTags, ...enTags, ...esTags])];

        // ── 3. ACTUALIZAR EL CEREBRO (TAGMAP) CON CATEGORÍAS ────────────
        const tagMapOps = aiTags.map(({ en, es, category }) => ({
            updateOne: {
                filter: { original: es.toLowerCase().trim() },
                update: { 
                    $set: { 
                        canonical: en.toLowerCase().trim(), 
                        category: category, // 👈 IMPORTANTE: Guardamos la categoría
                        language: 'es' 
                    } 
                },
                upsert: true
            }
        }));

        if (tagMapOps.length > 0) {
            await TagMap.bulkWrite(tagMapOps, { ordered: false });
            console.log(`📚 [TAGMAP] ${tagMapOps.length} mapeos con categoría actualizados`);
        }

        // ── 4. ACTUALIZAR EL WALLPAPER ──────────────────────────────────
        wallpaper.tags = finalTags;
        wallpaper.isAITagged = true;

        // Solo cambiamos la categoría si el wallpaper está en el default "Otros"
        const isDefault = !wallpaper.category || wallpaper.category === 'Otros';
        if (isDefault && dominantCategory) {
            wallpaper.category = dominantCategory;
            console.log(`🗂️ Nueva categoría asignada: ${dominantCategory}`);
        }

        await wallpaper.save();

        res.json({ 
            msg: 'IA procesada con éxito ✨', 
            tags: finalTags, 
            category: wallpaper.category,
            isAITagged: true 
        });

    } catch (err) {
        console.error("❌ Error crítico en retryAITagging:", err.message);
        res.status(500).json({ msg: 'Error interno al conectar con el servidor de IA' });
    }
};

// OBTENER ESTADÍSTICAS GLOBALES (SOLO ADMIN)
exports.getDashboardStats = async (req, res) => {
    try {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
        const fourDaysAgo = new Date(now.getTime() - (4 * 24 * 60 * 60 * 1000));

        const [
            totalUsers,
            newUsersWeek,
            dau,
            totalVisitors,
            newVisitorsWeek,
            totalWallpapers,
            pendingWallpapers,
            totalDownloads,
            totalLikes,
            statsByCategory,
            cohort
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
            Visitor.countDocuments({ lastActiveAt: { $gte: oneDayAgo } }),
            Visitor.countDocuments(),
            Visitor.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
            Wallpaper.countDocuments({ status: 'approved' }),
            Wallpaper.countDocuments({ status: 'pending' }),
            Wallpaper.aggregate([{ $group: { _id: null, total: { $sum: "$downloads" } } }]),
            Wallpaper.aggregate([{ $project: { count: { $size: "$likes" } } }, { $group: { _id: null, total: { $sum: "$count" } } }]),
            Wallpaper.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            Visitor.find({ lastDownloadAt: { $gte: fourDaysAgo, $lte: threeDaysAgo } })
        ]);

        // Cálculo de Retención (Usuarios que descargaron hace 3-4 días y volvieron hoy)
        const cohortSize = cohort.length;
        const retained = cohort.filter(v => v.lastActiveAt >= oneDayAgo).length;
        const retentionRate = cohortSize > 0 ? ((retained / cohortSize) * 100).toFixed(1) : 0;

        res.json({
            users: {
                total: totalUsers,
                newWeek: newUsersWeek,
                dau: dau, 
                totalVisitors: totalVisitors,
                newVisitorsWeek: newVisitorsWeek
            },
            content: {
                total: totalWallpapers,
                pending: pendingWallpapers,
                downloads: totalDownloads[0]?.total || 0,
                likes: totalLikes[0]?.total || 0,
                retention: retentionRate
            },
            categories: statsByCategory
        });
    } catch (err) {
        console.error("Error Stats:", err);
        res.status(500).json({ msg: 'Error al generar estadísticas' });
    }
};