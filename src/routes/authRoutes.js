const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware'); 
const { uploadCloud } = require('../config/cloudinary');

// RUTA: REGISTRO DE ARTISTA
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Verificar si el usuario ya existe
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'El usuario ya existe' });

        // Crear nuevo usuario
        user = new User({ username, email, password });

        // Encriptar contraseña
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        // Crear Token de sesión
        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, username: user.username } });
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error en el servidor');
    }
});

// RUTA: LOGIN
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Credenciales inválidas' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Credenciales inválidas' });

        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ 
                token, 
                user: { 
                    id: user.id, 
                    username: user.username,
                    instagram: user.instagram,
                    facebook: user.facebook 
                } 
            });
        });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});


// NUEVA RUTA: Actualizar redes sociales
router.put('/update-social', auth, async (req, res) => {
    const { instagram, facebook,  twitter, tiktok} = req.body;
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: { instagram, facebook, twitter, tiktok } },
            { new: true }
        ).select('-password');
        
        // --- ESTE CAMBIO ES LA CLAVE ---
        // Convertimos el objeto de Mongoose a un objeto plano y aseguramos el id
        const userObj = user.toObject();
        userObj.id = user._id; 

        res.json(userObj);
    } catch (err) {
        res.status(500).json({ msg: 'Error al actualizar' });
    }
});


// NUEVA RUTA: Obtener datos públicos de un artista
router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -email');
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).send('Error de servidor');
    }
});

// RUTA: Actualizar Foto de Perfil
router.put('/update-avatar', [auth, uploadCloud.single('avatar')], async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: 'No se subió ninguna imagen' });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: { profilePic: req.file.path } },
            { new: true }
        ).select('-password');

        const userObj = user.toObject();
        userObj.id = user._id;
        res.json(userObj);
    } catch (err) {
        res.status(500).send('Error al subir avatar');
    }
});

// SEGUIR O DEJAR DE SEGUIR ARTISTA
router.put('/follow/:id', auth, async (req, res) => {
    try {
        const artist = await User.findById(req.params.id);
        const currentUser = await User.findById(req.user.id);

        if (!artist) return res.status(404).json({ msg: 'Artista no encontrado' });

        // Si ya lo sigue -> Dejar de seguir (Unfollow)
        if (artist.followers.includes(req.user.id)) {
            artist.followers = artist.followers.filter(id => id.toString() !== req.user.id);
            currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
        } 
        // Si no lo sigue -> Seguir (Follow)
        else {
            artist.followers.push(req.user.id);
            currentUser.following.push(req.params.id);
        }

        await artist.save();
        await currentUser.save();

        res.json({ 
            followers: artist.followers, 
            following: currentUser.following 
        });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});


// ACTUALIZAR PERFIL COMPLETO (Username + Socials)
router.put('/update-profile', auth, async (req, res) => {
    const { username, instagram, facebook, twitter, tiktok } = req.body;

    try {
        // Verificar si el nuevo username ya existe (y no es el nuestro)
        if (username) {
            const existingUser = await User.findOne({ username });
            if (existingUser && existingUser._id.toString() !== req.user.id) {
                return res.status(400).json({ msg: 'El nombre de usuario ya está en uso' });
            }
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $set: { 
                    username: username,
                    instagram: instagram || "", 
                    facebook: facebook || "", 
                    twitter: twitter || "", 
                    tiktok: tiktok || "" 
                } 
            },
            { new: true }
        ).select('-password');
        
        const userObj = user.toObject();
        userObj.id = user._id; 

        res.json(userObj);
    } catch (err) {
        res.status(500).json({ msg: 'Error al actualizar perfil' });
    }
});

// CAMBIAR CONTRASEÑA
router.put('/change-password', auth, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // 1. Verificar si la contraseña actual es correcta
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'La contraseña actual no es correcta' });
        }

        // 2. Encriptar la nueva contraseña
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);

        await user.save();
        res.json({ msg: 'Contraseña actualizada con éxito' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error en el servidor');
    }
});

module.exports = router;