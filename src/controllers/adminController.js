const User = require('../models/User');
const { Expo } = require('expo-server-sdk');
const Wallpaper = require('../models/Wallpaper');
const Feedback = require('../models/Feedback');
const { cloudinary } = require('../config/cloudinary');
const { getAITags } = require('../services/aiService');

let expo = new Expo();

// 1. ENVIAR NOTIFICACIÓN GLOBAL (SOLO ADMIN) 
exports.broadcast = async (req, res) => {
    const { title, body } = req.body;

    try {
        // OBTENER TOKENS ÚNICOS (Solución al bug de duplicados)
        const uniqueTokens = await User.distinct('pushToken', { 
            pushToken: { $ne: "", $exists: true } 
        });

        console.log(`Iniciando envío masivo a ${uniqueTokens.length} dispositivos únicos.`);

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
                // Restamos 1 al contador del artista
                await User.findByIdAndUpdate(wall.artist, { $inc: { wallpaperCount: -1 } });

                // Borramos de Cloudinary
                if (wall.public_id) {
                    await cloudinary.uploader.destroy(wall.public_id);
                }

                // Borramos de la DB
                await Wallpaper.findByIdAndDelete(wallpaperId);
            }

            // Borramos el reporte
            await Feedback.findByIdAndDelete(reportId);
            
            return res.json({ msg: 'Contenido eliminado y contador de artista actualizado' });
        } 
        
        if (action === 'dismiss_report') {
            await Feedback.findByIdAndDelete(reportId);
            return res.json({ msg: 'Reporte descartado' });
        }

        res.status(400).json({ msg: 'Acción no válida' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error al procesar acción');
    }
};

// REINTENTAR ETIQUETADO POR IA (SOLO ADMIN)
exports.retryAITagging = async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        
        if (!wallpaper) {
            return res.status(404).json({ msg: 'Wallpaper no encontrado' });
        }

        // 1. Asegurar URL segura para la IA de Google
        const secureUrl = wallpaper.imageUrl.replace('http://', 'https://');

        console.log(`♻️ [ADMIN] Solicitando reintento de IA para: "${wallpaper.title}"`);
        
        // 2. Llamar al servicio de IA que creamos
        const aiTags = await getAITags(secureUrl);

        if (aiTags && aiTags.length > 0) {
            // 3. Mezcla inteligente (Tags viejos + Tags nuevos de IA)
            // Filtramos duplicados, pasamos a minúsculas y quitamos espacios vacíos
            const currentTags = wallpaper.tags || [];
            const finalTags = [...new Set([...currentTags, ...aiTags])]
                .map(tag => tag.trim().toLowerCase())
                .filter(tag => tag !== "");

            // 4. Actualizar registro
            wallpaper.tags = finalTags;
            wallpaper.isAITagged = true;
            await wallpaper.save();

            console.log(`✅ [ADMIN] Éxito: ${finalTags.length} etiquetas totales para "${wallpaper.title}"`);

            res.json({ 
                msg: 'IA procesada con éxito ✨', 
                tags: finalTags,
                isAITagged: true
            });
        } else {
            // Caso donde la IA responde pero no encuentra nada o hay saturación
            res.status(503).json({ 
                msg: 'La IA no pudo analizar la imagen en este momento. Espera 30 segundos y reintenta.' 
            });
        }
    } catch (err) {
        console.error("❌ Error crítico en retryAITagging:", err.message);
        res.status(500).json({ msg: 'Error interno al conectar con el servidor de IA' });
    }
};