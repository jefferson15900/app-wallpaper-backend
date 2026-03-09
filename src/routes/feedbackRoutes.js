const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const { cloudinary } = require('../config/cloudinary');

// 1. ENVIAR REPORTE O COMENTARIO
router.post('/', auth, async (req, res) => {
    try {
        const { type, message, targetWallpaper } = req.body;

        if (type === 'solicitud_verificacion') {
          await User.findByIdAndUpdate(req.user.id, { isVerificationPending: true });
        }
        
        const newFeedback = new Feedback({ 
            user: req.user.id, 
            type, 
            message,
            targetWallpaper: targetWallpaper || null 
        });

        await newFeedback.save();
        res.json({ msg: 'Reporte enviado con éxito' });
    } catch (err) { 
        res.status(500).send('Error al enviar feedback'); 
    }
});

// 2. OBTENER REPORTES (SOLO ADMIN) - Ahora trae los datos del Wallpaper
router.get('/admin', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado' });

        const reports = await Feedback.find()
            .populate('user', 'username email')
            .populate({
                path: 'targetWallpaper',
                select: 'imageUrl title public_id artist',
                populate: { path: 'artist', select: 'username' } // Para saber de quién es la foto
            })
            .sort({ createdAt: -1 });

        res.json(reports);
    } catch (err) { 
        res.status(500).send('Error al obtener reportes'); 
    }
});

// 3. ACCIÓN DEL ADMIN (BORRAR WALLPAPER O DESCARTAR REPORTE)
router.post('/admin/action', auth, async (req, res) => {
    const { reportId, action, wallpaperId } = req.body;
    
    try {
        const admin = await User.findById(req.user.id);
        if (admin.role !== 'admin') return res.status(403).json({ msg: 'No autorizado' });

        if (action === 'delete_content') {
            // 1. Buscamos el wallpaper para saber quién es el artista
            const wall = await Wallpaper.findById(wallpaperId);
            
            if (wall) {
                // 🟢 RESTAMOS 1 al contador físico del artista dueño de la foto
                await User.findByIdAndUpdate(wall.artist, { $inc: { wallpaperCount: -1 } });

                // 2. Borramos la imagen de Cloudinary
                if (wall.public_id) {
                    await cloudinary.uploader.destroy(wall.public_id);
                }

                // 3. Borramos el wallpaper de la base de datos
                await Wallpaper.findByIdAndDelete(wallpaperId);
            }

            // 4. Borramos el reporte de la lista de pendientes
            await Feedback.findByIdAndDelete(reportId);
            
            return res.json({ msg: 'Contenido eliminado y contador de artista actualizado' });
        } 
        
        if (action === 'dismiss_report') {
            // Solo borramos el reporte, no tocamos el wallpaper ni el contador
            await Feedback.findByIdAndDelete(reportId);
            return res.json({ msg: 'Reporte descartado' });
        }

        res.status(400).json({ msg: 'Acción no válida' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error al procesar acción');
    }
});

// ELIMINAR UN REPORTE (Antiguo método, se mantiene por compatibilidad)
router.delete('/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado' });
        await Feedback.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Reporte eliminado' });
    } catch (err) { res.status(500).send('Error'); }
});

module.exports = router;