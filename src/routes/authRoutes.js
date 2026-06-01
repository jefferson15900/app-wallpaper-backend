const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const auth = require('../middleware/authMiddleware'); 
const { uploadCloud, cloudinaryPrimary, cloudinarySecondary } = require('../config/cloudinary');
const { Expo } = require('expo-server-sdk'); 
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit'); 
const mongoose = require('mongoose');

const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    statusCode: 429, 
    message: { 
        msg: "Has realizado demasiados intentos. Por seguridad, inténtalo de nuevo en 15 minutos." 
    },
    
    standardHeaders: true, 
    legacyHeaders: false,
    
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    }
});


const client = new OAuth2Client("1097525571797-38k9poarb7gbtgks5ekieddkss876cm3.apps.googleusercontent.com");

let dailyArtistsCache = [];
let lastUpdateDate = null;

let expo = new Expo();
// RUTA: REGISTRO DE ARTISTA
router.post('/register', async (req, res) => {
    const { email, password } = req.body; 
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'El usuario ya existe' });

        // Generamos un ID temporal interno para que la DB sea feliz
        const tempId = "user_" + Math.random().toString(36).substring(7);

        user = new User({ 
            username: tempId, // Nombre temporal interno
            email, 
            password 
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();

        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, username: "", isGoogleUser: false } }); // Enviamos username vacío al frontend
        });
    } catch (err) {
        res.status(500).send('Error');
    }
});

// RUTA: LOGIN
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // 1. Buscar usuario
        let user = await User.findOne({ email });
        
        if (!user) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // 2. Verificar Contraseña
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // 🚀 3. LÓGICA DE REACTIVACIÓN CON LOGS
        if (user.isActive === false) {
            user.isActive = true;
            user.deactivatedAt = null;
            await user.save();
            
        }
        // 4. Generación de Token
        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) {
                console.error(`🔥 [ERROR JWT]: ${err.message}`);
                throw err;
            }
            
            res.json({ 
                token, 
                user: { 
                    id: user.id, 
                    username: user.username,
                    profilePic: user.profilePic, 
                    isVerified: user.isVerified,
                    bio: user.bio,            
                    instagram: user.instagram,
                    facebook: user.facebook,
                    threads: user.threads,
                    tiktok: user.tiktok,
                    twitter: user.twitter,
                    role: user.role,
                    isActive: true,
                    isGoogleUser: user.isGoogleUser || false
                } 
            });
        });

    } catch (err) {
        console.error(`🔥 [ERROR CRÍTICO SERVER]: ${err.message}`);
        res.status(500).send('Error en el servidor');
    }
});

// RUTA: LOGIN CON GOOGLE
router.post('/google-login', async (req, res) => {
    const { idToken } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: "1097525571797-38k9poarb7gbtgks5ekieddkss876cm3.apps.googleusercontent.com", 
        });
        const { email } = ticket.getPayload();

        // BUSCAMOS SI EXISTE
        let user = await User.findOne({ email });

        if (!user) {
            // SI NO EXISTE, ENVIAMOS ERROR (No se registra solo)
            return res.status(404).json({ msg: 'Esta cuenta de Google no está registrada. Ve a Registro primero.' });
        }

        // Auto-migración si es necesario
        if (!user.isGoogleUser) {
            user.isGoogleUser = true;
            await user.save();
        }

        // SI EXISTE, LOGUEAMOS
        const jwtPayload = { user: { id: user.id } };
        jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, username: user.username, profilePic: user.profilePic, isGoogleUser: true } });
        });
    } catch (error) {
        res.status(400).json({ msg: 'Error de autenticación' });
    }
});

// 2. RUTA: REGISTRO CON GOOGLE (Solo usuarios nuevos)
router.post('/google-register', async (req, res) => {
    const { idToken } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: "1097525571797-38k9poarb7gbtgks5ekieddkss876cm3.apps.googleusercontent.com", 
        });
        const { email, name, picture, sub: googleId } = ticket.getPayload();

        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ msg: 'Esta cuenta ya está registrada. Por favor, inicia sesión.' });
        }

        // CREAMOS EL NUEVO USUARIO
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(googleId, salt);

        user = new User({
            username: name.replace(/\s+/g, '').toLowerCase() + Math.floor(Math.random() * 100),
            email,
            password: hashedPassword,
            profilePic: picture,
            role: 'artist',
            isGoogleUser: true
        });
        await user.save();

        const jwtPayload = { user: { id: user.id } };
        jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, username: user.username, profilePic: user.profilePic, isGoogleUser: true } });
        });
    } catch (error) {
        res.status(400).json({ msg: 'Error al registrar con Google' });
    }
});

// NUEVA RUTA: Actualizar redes sociales
router.put('/update-social', auth, async (req, res) => {
    const { instagram, facebook,  twitter, tiktok, threads} = req.body;
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: { instagram, facebook, twitter, tiktok, threads } },
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


//CORREO 
router.get('/me', auth, async (req, res) => {
    try {

        const user = await User.findById(req.user.id).select('-password');
        
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });
        
        res.json(user);
    } catch (err) {
        res.status(500).send('Error de servidor');
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
        if (!req.file) return res.status(400).json({ msg: 'No se recibió imagen' });

        // 1. Buscar al usuario actual
        const user = await User.findById(req.user.id);

        // 2. Si el usuario ya tenía una foto (profilePicId), borrarla de Cloudinary
        if (user.profilePicId) {
            await cloudinaryPrimary.uploader.destroy(user.profilePicId);
        }

        // 3. Guardar la nueva URL y el nuevo ID
        user.profilePic = req.file.path;
        user.profilePicId = req.file.filename; // filename es el public_id que nos da Cloudinary
        
        await user.save();

        const userObj = user.toObject();
        userObj.id = user._id;
        res.json(userObj);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al actualizar el avatar');
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
    const { username, bio, instagram, facebook, twitter, tiktok, threads, gender, birthday, country,nativeLanguage } = req.body;

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
                    bio: bio || "",
                    instagram: instagram || "",  
                    facebook: facebook || "", 
                    twitter: twitter || "", 
                    tiktok: tiktok || "",
                    threads : threads || "",
                    gender,    
                    birthday,  
                    country,
                    nativeLanguage    
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


// Obtener lista de Seguidos (Following)
router.get('/following/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('following', 'username profilePic isVerified');
        res.json(user.following);
    } catch (err) {
        res.status(500).send('Error al obtener seguidos');
    }
});

// Obtener lista de Seguidores (Followers)
router.get('/followers/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('followers', 'username profilePic isVerified');
        res.json(user.followers);
    } catch (err) {
        res.status(500).send('Error al obtener seguidores');
    }
});


// OBTENER TODOS LOS ARTISTAS (Público)
// RUTA: OBTENER ARTISTAS RECOMENDADOS (Rotación cada 24h)
router.get('/all-artists', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Obtiene la fecha hoy (YYYY-MM-DD)

        // 1. Si el caché tiene datos y la fecha es la misma que hoy, devolvemos el caché
        if (dailyArtistsCache.length > 0 && lastUpdateDate === today) {
            return res.json(dailyArtistsCache);
        }

        // 2. Si es un nuevo día o el servidor se reinició, elegimos 15 nuevos
        const newSelection = await User.aggregate([
            { $match: { role: 'artist', isVerified: true } },
            { $sample: { size: 15 } },
            { $project: { 
                username: 1, 
                profilePic: 1, 
                isVerified: 1 
            }}
        ]);

        // 3. Si no hay suficientes verificados, rellenamos con normales
        if (newSelection.length < 5) {
            const backups = await User.find({ role: 'artist', isVerified: false })
                .limit(10)
                .select('username profilePic isVerified');
            dailyArtistsCache = [...newSelection, ...backups];
        } else {
            dailyArtistsCache = newSelection;
        }

        // 4. Guardamos la fecha del último cambio
        lastUpdateDate = today;

        res.json(dailyArtistsCache);
    } catch (err) {
        res.status(500).send('Error');
    }
});

// GUARDAR PUSH TOKEN (Para notificaciones)
router.put('/save-token', auth, async (req, res) => {
    const { token } = req.body;

    try {
        await User.updateMany(
            { pushToken: token }, 
            { $set: { pushToken: "" } }
        );

        await User.findByIdAndUpdate(req.user.id, { 
            pushToken: token 
        });

        res.json({ msg: 'Token de notificaciones actualizado' })    ;
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al guardar token');
    }
});

// GUARDADO GUSTOS DEL USUARIO
router.put('/sync-interests', auth, async (req, res) => {
    try {
        const { interests } = req.body;
        
        await User.findByIdAndUpdate(req.user.id, { 
            $set: { 
                interests: interests,
                isFeedDirty: true
            } 
        });

        res.json({ msg: 'ADN Sincronizado ✨' });
    } catch (err) {
        res.status(500).send('Error de sincronización');
    }
});

// ── DESACTIVAR CUENTA (Temporal) ──
router.post('/deactivate', auth, rateLimiter, async (req, res) => {
    try {
        const { password } = req.body;

        // 1. Verificar contraseña antes de proceder
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        if (user.isActive === false) {
            return res.status(400).json({ msg: 'La cuenta ya está desactivada' });
        }

        // Si no es usuario de Google, se requiere y verifica contraseña
        if (!user.isGoogleUser) {
            if (!password) return res.status(400).json({ msg: 'La contraseña es obligatoria' });
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ msg: 'Contraseña incorrecta' });
        }

        // 2. Desactivar cuenta
        await User.findByIdAndUpdate(
            req.user.id,
            { $set: { isActive: false, deactivatedAt: new Date() } }
        );


        return res.status(200).json({ msg: 'Cuenta desactivada correctamente' });

    } catch (err) {
        console.error('Error al desactivar cuenta:', err);
        return res.status(500).json({ msg: 'Error al desactivar cuenta' });
    }
});

// ── ELIMINAR CUENTA (Definitivo) ──
router.delete('/delete-account', auth, rateLimiter, async (req, res) => {
    const userId = req.user.id;
    const { password } = req.body;

    try {
        // 1. VERIFICACIÓN INICIAL (Fuera de la transacción para ser rápidos)
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // Si no es usuario de Google, se requiere y verifica contraseña
        if (!user.isGoogleUser) {
            if (!password) return res.status(400).json({ msg: 'La contraseña es obligatoria' });
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ msg: 'Contraseña incorrecta' });
        }

        // 2. LIMPIEZA DE CLOUDINARY (Fuera de la transacción)
        // Cloudinary es lento. Si lo metemos en la transacción, MongoDB se cansa de esperar y da error.
        const userWallpapers = await Wallpaper.find({ artist: userId }).select('public_id type');
        
        await Promise.allSettled([
            ...userWallpapers.filter(w => w.public_id).map(w => {
                const cloudinaryInstance = w.type === 'video' ? cloudinarySecondary : cloudinaryPrimary;
                return cloudinaryInstance.uploader.destroy(w.public_id, {
                    resource_type: w.type === 'video' ? 'video' : 'image'
                });
            }),
            user.profilePicId ? cloudinaryPrimary.uploader.destroy(user.profilePicId) : Promise.resolve()
        ]);

        // 3. TRANSACCIÓN DE BASE DE DATOS (Usando withTransaction para auto-reintentos)
        const session = await mongoose.startSession();
        
        try {
            await session.withTransaction(async () => {
                // Paso A: Borrar sus wallpapers
                await Wallpaper.deleteMany({ artist: userId }, { session });

                // Paso B: Quitar sus likes (Ejecución SECUENCIAL, no paralela para evitar conflictos)
                await Wallpaper.updateMany(
                    { likes: userId },
                    { $pull: { likes: userId } },
                    { session }
                );

                // Paso C: Borrar al usuario
                await User.findByIdAndDelete(userId, { session });
            });
            
            return res.status(204).send();

        } finally {
            await session.endSession();
        }

    } catch (err) {
        console.error('❌ Error crítico al eliminar cuenta:', err);
        // Si el error es de MongoDB, enviamos un mensaje más claro
        const message = err.name === 'MongoServerError' ? 'Conflicto de red en la base de datos. Por favor, intenta de nuevo.' : 'Error al eliminar cuenta';
        return res.status(500).json({ msg: message });
    }
});

// RUTA PARA CHEQUEAR VERSIÓN (Pública)
router.get('/version-check', (req, res) => {
    res.json({ 
        latestVersion: "2.0.0", // El nombre de la versión
        minVersionCode: 2,      // El versionCode que pusiste en app.json
        forceUpdate: true,      // Si es true, el usuario NO puede cerrar el aviso
        storeUrl: "https://play.google.com/store/apps/details?id=com.jefferson159.appwallpaper"
    });
});

module.exports = router;