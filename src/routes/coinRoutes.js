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

// REGALO DIARIO 5 GEMAS
router.post('/daily-reward', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const now = new Date();
        const lastClaim = user.lastDailyRewardAt || new Date(0);

        // Diferencia en milisegundos convertida a horas
        const hoursPassed = (now - lastClaim) / (1000 * 60 * 60);

        if (hoursPassed >= 24) { 
            user.coins = (user.coins || 0) + 5;
            user.lastDailyRewardAt = now;
            await user.save();
            
            return res.json({ 
                success: true, 
                msg: "¡Premio diario reclamado!", 
                reward: 5, 
                newBalance: user.coins 
            });
        }

        // Si no han pasado 24h, enviamos cuánto tiempo falta
        const hoursRemaining = Math.ceil(24 - hoursPassed);
        res.status(400).json({ 
            success: false, 
            msg: `Vuelve en ${hoursRemaining} horas para más Gems.` 
        });

    } catch (err) {
        res.status(500).send('Error en el premio diario');
    }
});

module.exports = router;