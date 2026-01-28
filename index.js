require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');
const compression = require('compression');
const app = express();

app.get('/app-ads.txt', (req, res) => {
 
    res.send('google.com, pub-7650198007053979, DIRECT, f08c47fec0942fa0');
});

// --- RUTA PARA POLÍTICA DE PRIVACIDAD ---
app.get('/privacy', (req, res) => {
    res.send(`
        <html>
            <head><title>Política de Privacidad - Wallpaper Hub</title></head>
            <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; color: #333;">
                <h1>Política de Privacidad de Wallpaper Hub</h1>
                <p>Fecha de entrada en vigor: 25 de enero de 2026</p>
                
                <h2>1. Información que recopilamos</h2>
                <p>Recopilamos su dirección de correo electrónico y nombre de usuario cuando se registra como artista. También procesamos las imágenes que usted decide subir a nuestra plataforma.</p>
                
                <h2>2. Uso de los datos</h2>
                <p>Sus datos se utilizan para gestionar su cuenta de artista, permitir la interacción social (likes y seguidores) y mostrar sus obras a otros usuarios.</p>
                
                <h2>3. Servicios de terceros</h2>
                <p>Utilizamos <b>Google AdMob</b> para mostrar anuncios, el cual puede recopilar identificadores de dispositivo para personalizar la publicidad. Las imágenes se almacenan de forma segura en <b>Cloudinary</b> y los datos en <b>MongoDB Atlas</b>.</p>
                
                <h2>4. Sus derechos</h2>
                <p>Usted puede eliminar sus imágenes en cualquier momento desde su perfil. Para solicitar la eliminación total de su cuenta, contáctenos a través de la sección de soporte de la app.</p>
                
                <p>Contacto: walllpapaercorp@gmail.com</p>
            </body>
        </html>
    `);
});

// --- RUTA PARA SOLICITUD DE ELIMINACIÓN DE DATOS ---
app.get('/delete-account', (req, res) => {
    res.send(`
        <html>
            <head><title>Eliminar Cuenta - Wallpaper Hub</title></head>
            <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; color: #333;">
                <h1>Solicitud de Eliminación de Cuenta y Datos</h1>
                <p>En Wallpaper Hub respetamos su privacidad. Si desea eliminar su cuenta de artista y todos sus datos asociados, por favor siga las instrucciones:</p>
                <ol>
                    <li>Envíe un correo electrónico a: <b>walllpapaercorp@gmail.com</b></li>
                    <li>El asunto debe ser: <b>"Solicitud de eliminación de cuenta - Wallpaper Hub"</b></li>
                    <li>En el mensaje, incluya su nombre de usuario.</li>
                </ol>
                <p>Una vez recibida la solicitud, procederemos a borrar permanentemente su perfil, correos y wallpapers de nuestros servidores en un plazo máximo de 7 días.</p>
            </body>
        </html>
    `);
});
// Middlewares
app.use(compression());
app.use(cors());
app.use(express.json());

// Conexión a Base de Datos
connectDB();

// Rutas (las crearemos a continuación)
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/wallpapers', require('./src/routes/wallpaperRoutes'));
app.use('/api/feedback', require('./src/routes/feedbackRoutes'));

// Manejador de errores global
app.use((err, req, res, next) => {
    console.error(err.stack); // Esto te dirá qué falló en la terminal
    res.status(500).json({
        msg: 'Hubo un error en el servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));