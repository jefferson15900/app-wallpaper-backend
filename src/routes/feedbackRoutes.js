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