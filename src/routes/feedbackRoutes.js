const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const Feedback = require('../models/Feedback');
const User = require('../models/User');

// Enviar Reporte o Comentario (Cualquier usuario logueado)
router.post('/', auth, async (req, res) => {
    try {
        const { type, message } = req.body;
        const newFeedback = new Feedback({ user: req.user.id, type, message });
        await newFeedback.save();
        res.json({ msg: 'Enviado con éxito' });
    } catch (err) { res.status(500).send('Error'); }
});

// Obtener todos los reportes (SOLO ADMIN)
router.get('/admin', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado' });

        const reports = await Feedback.find().populate('user', 'username email').sort({ createdAt: -1 });
        res.json(reports);
    } catch (err) { res.status(500).send('Error'); }
});


// Eliminar un reporte (SOLO ADMIN)
router.delete('/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Acceso denegado' });

        await Feedback.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Reporte eliminado' });
    } catch (err) {
        res.status(500).send('Error al eliminar');
    }
});
module.exports = router;