const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { uploadCloud } = require('../config/cloudinary');
const wallpaperController = require('../controllers/wallpaperController');
const isAdmin = require('../middleware/adminMiddleware');
// VARIABLES PARA CACHÉ #HASHTAGS
let trendingTagsCache = [];
let lastTagsUpdate = null;

// 1. RUTAS DE BÚSQUEDA Y FEED (Públicas y específicas)
// Deben ir arriba para que no se confundan con un ID
router.get('/search', wallpaperController.searchWallpapers);
router.get('/tags/search', wallpaperController.searchTags);
router.get('/tags/popular', wallpaperController.getPopularTags);
router.get('/discovery', wallpaperController.getDiscoveryFeed);
router.get('/latest', wallpaperController.getLatestWallpapers);
router.get('/spotlight', wallpaperController.getSpotlights);
router.get('/floating-bubbles', wallpaperController.getFloatingBubbles);

// 2. RUTAS DE PERFIL Y BIBLIOTECA
router.get('/artist/:artistId', wallpaperController.getArtistWallpapers);
router.get('/my/library', auth, wallpaperController.getUserLibrary);

// 3. RUTAS DE ACCIÓN (POST y PUT)
router.post('/upload', [auth, uploadCloud.array('image', 10)], wallpaperController.uploadWallpaper);
router.put('/download/:id', wallpaperController.registerDownload);
router.put('/like/:id', auth, wallpaperController.toggleLike);
router.put('/save/:id', auth, wallpaperController.toggleSave);
router.put('/admin/remove-tag/:id', [auth, isAdmin], wallpaperController.adminRemoveTag);
router.put('/admin/add-tag/:id', [auth, isAdmin], wallpaperController.adminAddTag);
router.post('/admin/spotlight', [auth, isAdmin], wallpaperController.addSpotlight);
router.delete('/admin/spotlight/:id', [auth, isAdmin], wallpaperController.deleteSpotlight);
router.post('/admin/floating-bubbles', [auth, isAdmin], wallpaperController.addFloatingBubble);
router.delete('/admin/floating-bubbles/:id', [auth, isAdmin], wallpaperController.deleteFloatingBubble);

router.get('/related/:id', wallpaperController.getRelatedWallpapers);

// 4. RUTAS DINÁMICAS POR ID (SIEMPRE AL FINAL)
// Si pones estas arriba, bloquearán a /search y /discovery
router.get('/:id', wallpaperController.getWallpaperById);
router.delete('/:id', auth, wallpaperController.deleteWallpaper);


// --- RUTA: FEED DE SEGUIDOS (Solo para usuarios logueados) ---
router.get('/feed', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user.following || user.following.length === 0) {
            return res.json([]); 
        }

        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const wallpapers = await Wallpaper.find({ 
            artist: { $in: user.following }, 
            status: 'approved' // <--- ESTO ES LO QUE FILTRA
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

        res.json(wallpapers);
    } catch (err) {
        res.status(500).send('Error');
    }
});

// ======================================================
// RUTAS DE CONTENIDO DESTACADO (PREMIUM)
// ======================================================

// 1. Obtener Wallpapers marcados como Premium (Para el Carrusel del Home)
router.get('/featured/premium', async (req, res) => {
    try {
        const premiumWalls = await Wallpaper.find({ 
            isPremium: true, 
            status: 'approved' 
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .limit(6); // Limitamos a los 6 mejores para no saturar el carrusel

        res.json(premiumWalls);
    } catch (err) {
        res.status(500).send('Error al obtener contenido premium');
    }
});

// 2. Marcar/Desmarcar como Premium (SOLO ADMIN)
router.put('/admin/set-premium/:id', auth, async (req, res) => {
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
});


// ======================================================
// 2. RUTAS DE INFORMACIÓN Y PERFILES
// ======================================================

// Obtener información pública de un usuario/artista
router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -email'); 
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).send('Error al obtener datos del usuario');
    }
});


// ======================================================
// RUTAS DE CONTENIDO DESTACADO (PREMIUM)
// ======================================================

// 1. Obtener Wallpapers marcados como Premium (Para el Carrusel del Home)
router.get('/featured/premium', async (req, res) => {
    try {
        const premiumWalls = await Wallpaper.find({ 
            isPremium: true, 
            status: 'approved' 
        })
        .populate('artist', 'username profilePic isVerified')
        .sort({ createdAt: -1 })
        .limit(6); // Limitamos a los 6 mejores para no saturar el carrusel

        res.json(premiumWalls);
    } catch (err) {
        res.status(500).send('Error al obtener contenido premium');
    }
});


// OBTENER LOS 10 HASHTAGS MÁS USADOS (Con caché de 24h)
router.get('/tags/trending', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        if (trendingTagsCache.length > 0 && lastTagsUpdate === today) {
            return res.json(trendingTagsCache);
        }
     
        const excludedTags = ['espacio', 'autos', 'abstracto', 'otros', 'live', 'general', '', ' '];

        const result = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: "$tags" },
            { 
                $project: { 
                    cleanTag: { $trim: { input: { $toLower: "$tags" } } } 
                } 
            },
            // Filtramos las etiquetas que no queremos y las vacías
            { $match: { cleanTag: { $nin: excludedTags } } },
            // Agrupamos por la etiqueta limpia
            { $group: { _id: "$cleanTag", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 30 }
        ]);

        const tagsOnly = result.map(tag => tag._id);

        trendingTagsCache = tagsOnly;
        lastTagsUpdate = today;

        res.json(tagsOnly);
    } catch (err) {
        res.status(500).send('Error');
    }
});

module.exports = router;  