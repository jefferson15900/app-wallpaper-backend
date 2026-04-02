const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');

// 1. GANAR MONEDAS POR ANUNCIO
router.post('/claim-reward', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const today = new Date().toISOString().split('T')[0];

        // Resetear contador si es un nuevo día
        if (user.lastAdDate !== today) {
            user.adsSeenToday = 0;
            user.lastAdDate = today;
        }

        // Lógica de recompensa: 3 monedas los primeros 2 ads, luego 2
        const reward = user.adsSeenToday < 2 ? 3 : 2;
        
        user.coins = (user.coins || 0) + reward; 
        user.adsSeenToday += 1;
        
        await user.save();
        res.json({ coins: user.coins, reward, adsToday: user.adsSeenToday });
    } catch (err) {
        res.status(500).send('Error al procesar recompensa');
    }
});

// 2. COMPRAR / DESBLOQUEAR WALLPAPER
router.post('/unlock/:id', auth, async (req, res) => {
    try {
        const wallpaper = await Wallpaper.findById(req.params.id);
        const user = await User.findById(req.user.id);

        if (!wallpaper || wallpaper.price === 0) return res.status(400).json({ msg: 'Wallpaper no es premium' });
        if (user.coins < wallpaper.price) return res.status(400).json({ msg: 'Monedas insuficientes' });
        if (user.unlockedWallpapers.includes(wallpaper._id)) return res.status(400).json({ msg: 'Ya desbloqueado' });

        // Transacción
        user.coins -= wallpaper.price;
        user.unlockedWallpapers.push(wallpaper._id);
        
        await user.save();
        res.json({ msg: 'Desbloqueado con éxito', coins: user.coins });
    } catch (err) {
        res.status(500).send('Error en la compra');
    }
});

module.exports = router;