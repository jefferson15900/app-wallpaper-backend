const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallpaper = require('../models/Wallpaper');
const auth = require('../middleware/authMiddleware'); 
const { uploadCloud , cloudinary } = require('../config/cloudinary');
const { Expo } = require('expo-server-sdk'); 
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client("342764820033-lo8036tgoeeoc4eltu21k70fhq3cskd2.apps.googleusercontent.com");

let dailyArtistsCache = [];
let lastUpdateDate = null;

let expo = new Expo();
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

// RUTA: LOGIN / REGISTRO CON GOOGLE
router.post('/google-login', async (req, res) => {
    const { idToken } = req.body;

    try {
        // 1. Verificar el token con Google
        const ticket = await client.verifyIdToken({
            idToken,
            audience: "342764820033-lo8036tgoeeoc4eltu21k70fhq3cskd2.apps.googleusercontent.com", 
        });
        const payload = ticket.getPayload();
        const { email, name, picture, sub: googleId } = payload;

        // 2. Buscar si el usuario ya existe por email
        let user = await User.findOne({ email });

        if (!user) {
            // Si no existe, creamos la cuenta automáticamente
            // Generamos una contraseña aleatoria (aunque no se use para login con Google, el modelo la pide)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(googleId, salt); 

            user = new User({
                username: name.replace(/\s+/g, '').toLowerCase() + Math.floor(Math.random() * 100),
                email,
                password: hashedPassword,
                profilePic: picture, // Usamos la foto de Google
                role: 'artist',
                isVerified: false
            });
            await user.save();
            console.log(`✅ Nuevo usuario creado vía Google: ${user.username}`);
        }

        // 3. Generar el Token JWT de tu propia App (como en el login normal)
        const jwtPayload = { user: { id: user.id } };
        jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
            if (err) throw err;
            res.json({ 
                token, 
                user: { 
                    id: user.id, 
                    username: user.username, 
                    profilePic: user.profilePic,
                    isVerified: user.isVerified 
                } 
            });
        });

    } catch (error) {
        console.error("❌ Error en Google Login:", error);
        res.status(400).json({ msg: 'Token de Google inválido o expirado' });
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
        if (!req.file) return res.status(400).json({ msg: 'No se recibió imagen' });

        // 1. Buscar al usuario actual
        const user = await User.findById(req.user.id);

        // 2. Si el usuario ya tenía una foto (profilePicId), borrarla de Cloudinary
        if (user.profilePicId) {
            await cloudinary.uploader.destroy(user.profilePicId);
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
    const { username, bio, instagram, facebook, twitter, tiktok } = req.body;

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

// A. OBTENER PROGRESO DE VERIFICACIÓN (Para el propio usuario)
router.get('/verification-progress', auth, async (req, res) => {
    try {
        // Contamos cuántos wallpapers tiene este usuario con estado 'approved'
        const count = await Wallpaper.countDocuments({ 
            artist: req.user.id, 
            status: 'approved' 
        });

        res.json({
            approvedCount: count,
            goal: 50,
            isEligible: count >= 50,
            isVerified: (await User.findById(req.user.id)).isVerified
        });
    } catch (err) {
        res.status(500).send('Error al calcular progreso');
    }
});


// OBTENER TODOS LOS ARTISTAS (Público)
// RUTA: OBTENER ARTISTAS RECOMENDADOS (Rotación cada 24h)
router.get('/all-artists', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Obtiene la fecha hoy (YYYY-MM-DD)

        // 1. Si el caché tiene datos y la fecha es la misma que hoy, devolvemos el caché
        if (dailyArtistsCache.length > 0 && lastUpdateDate === today) {
            console.log("🚀 Entregando artistas desde el caché diario");
            return res.json(dailyArtistsCache);
        }

        // 2. Si es un nuevo día o el servidor se reinició, elegimos 15 nuevos
        console.log("♻️ Rotando selección diaria de artistas...");
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

        res.json({ msg: 'Token de notificaciones actualizado' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al guardar token');
    }
});

// ENVIAR NOTIFICACIÓN GLOBAL (SOLO ADMIN) 
router.post('/broadcast', auth, async (req, res) => {
    const { title, body } = req.body;

    try {
        // 1. Verificación de seguridad de Administrador
        const admin = await User.findById(req.user.id);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado. Se requieren permisos de administrador.' });
        }

        // 2. OBTENER TOKENS ÚNICOS (Solución al bug de duplicados)
        // Usamos .distinct para obtener una lista de strings únicos, ignorando si varios usuarios tienen el mismo token
        const uniqueTokens = await User.distinct('pushToken', { 
            pushToken: { $ne: "", $exists: true } 
        });

        console.log(`Iniciando envío masivo a ${uniqueTokens.length} dispositivos únicos.`);

        if (uniqueTokens.length === 0) {
            return res.status(400).json({ msg: 'No hay dispositivos registrados para recibir notificaciones' });
        }

        // 3. Preparar los mensajes para Expo
        let messages = [];
        for (let token of uniqueTokens) {
            // Validar que el token sea un token de Expo real
            if (Expo.isExpoPushToken(token)) {
                messages.push({
                    to: token,
                    sound: 'default',
                    title: title || '✨ ¡Nuevos Wallpapers!',
                    body: body || 'Hemos subido arte nuevo. ¡Entra a descubrirlo!',
                    data: { screen: 'Explorar' },
                    priority: 'high',
                    channelId: 'default', // Recomendado para Android moderno
                });
            } else {
                console.log(`Token detectado como inválido: ${token}`);
            }
        }

        // 4. Envío por lotes (Chunks) para evitar bloqueos de red
        let chunks = expo.chunkPushNotifications(messages); 
        let tickets = [];
        
        // Ejecutamos el envío de los lotes
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error("Error al enviar un lote de notificaciones:", error);
            }
        }

        // 5. Respuesta al cliente
        res.json({ 
            msg: `Proceso completado con éxito`, 
            dispositivosAlcanzados: uniqueTokens.length,
            mensajesProcesados: messages.length 
        });

    } catch (err) {
        console.error("Error crítico en la función broadcast:", err);
        res.status(500).send('Error interno del servidor al enviar notificaciones');
    }
});



// B. TOGGLE VERIFICACIÓN (SOLO ADMIN - Para dar o quitar el Check Azul)
router.put('/admin/verify-user/:userId', auth, async (req, res) => {
    try {
        // Verificamos que quien pide esto sea el Admin
        const admin = await User.findById(req.user.id);
        if (admin.role !== 'admin') return res.status(403).json({ msg: 'No autorizado' });

        const userToVerify = await User.findById(req.params.userId);
        if (!userToVerify) return res.status(404).json({ msg: 'Usuario no encontrado' });

        // Cambiamos el estado (si era false pasa a true y viceversa)
        userToVerify.isVerified = !userToVerify.isVerified;
        await userToVerify.save();

        res.json({ 
            msg: `Usuario ${userToVerify.username} ${userToVerify.isVerified ? 'Verificado' : 'Sin Verificar'}`,
            isVerified: userToVerify.isVerified 
        });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

// RUTA PARA CHEQUEAR VERSIÓN (Pública)
router.get('/version-check', (req, res) => {
    res.json({ 
        latestVersion: "1.1.4", // El nombre de la versión
        minVersionCode: 13,      // El versionCode que pusiste en app.json
        forceUpdate: true,      // Si es true, el usuario NO puede cerrar el aviso
        storeUrl: "https://play.google.com/store/apps/details?id=com.jefferson159.appwallpaper"
    });
});

module.exports = router;