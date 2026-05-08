require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');
const compression = require('compression');
const configRoutes = require('./src/routes/configRoutes');

const app = express();
app.set('trust proxy', 1);

// 1. MIDDLEWARES INICIALES
app.use(compression());
app.use(cors()); // CORS al principio para que los bots no tengan problemas de cabeceras
app.use(express.json());

// 2. RUTAS PÚBLICAS PARA GOOGLE / ADMOB (Súper simplificadas)
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    // "Disallow:" vacío significa: "Todos los robots pueden entrar a todo"
    res.send("User-agent: *\nDisallow:"); 
});

app.get('/app-ads.txt', (req, res) => {
    res.type('text/plain');
    res.send('google.com, pub-7650198007053979, DIRECT, f08c47fec0942fa0');
});

// 3. RUTA RAÍZ (Para evitar el "Cannot GET /" y parecer un sitio oficial)
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Vexel - Official Website</title></head>
            <body style="background-color: #0a0c10; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center;">
                <div>
                    <h1 style="letter-spacing: 10px; font-size: 50px;">VEXEL</h1>
                    <p style="color: #566375; font-weight: bold;">PREMIUM WALLPAPER COMMUNITY</p>
                    <div style="margin-top: 20px;">
                        <a href="/privacy" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Privacy</a>
                        <a href="/delete-account" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Support</a>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// 4. POLÍTICA DE PRIVACIDAD (Unificada con el nombre Vexel)
app.get('/privacy', (req, res) => {
    res.send(`
        <html>
            <head><title>Privacy Policy - Vexel</title></head>
            <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: auto;">
                <h1>Privacy Policy for Vexel</h1>
                <p>Effective Date: May 1, 2026</p>
                <h2>1. Information We Collect</h2>
                <p>We collect your email address and username when you register. We also process the images you upload to our platform.</p>
                <h2>2. Usage of Data</h2>
                <p>Your data is used to manage your account, enable social interactions (likes/follows), and display your art to the community.</p>
                <h2>3. Third-Party Services</h2>
                <p>We use <b>Google AdMob</b> for advertising and <b>Cloudinary</b> for secure image storage.</p>
                <p>Contact: walllpapaercorp@gmail.com</p>
            </body>
        </html>
    `);
});

// 5. SOLICITUD DE ELIMINACIÓN
app.get('/delete-account', (req, res) => {
    res.send(`
        <html>
            <head><title>Delete Account - Vexel</title></head>
            <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: auto;">
                <h1>Account and Data Deletion</h1>
                <p>To delete your account and all associated data, please follow these steps:</p>
                <ol>
                    <li>Send an email to: <b>walllpapaercorp@gmail.com</b></li>
                    <li>Subject: <b>"Account Deletion Request - Vexel"</b></li>
                    <li>Include your username in the message.</li>
                </ol>
                <p>Your profile and content will be permanently removed within 7 days.</p>
            </body>
        </html>
    `);
});

// 6. CONEXIÓN Y RUTAS DE API
connectDB();
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/wallpapers', require('./src/routes/wallpaperRoutes'));
app.use('/api/feedback', require('./src/routes/feedbackRoutes'));
app.use('/api/coins', require('./src/routes/coinRoutes'));
app.use('/api/config', configRoutes);

// 7. MANEJADOR DE ERRORES
app.use((err, req, res, next) => {
    const status = err.statusCode ?? 500;
    console.error(`[${req.method}] ${req.path} → ${err.message}`);
    res.status(status).json({
        msg: status < 500 ? err.message : 'Internal Server Error',
    });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));

// CIERRE LIMPIO
const shutdown = (signal) => {
    server.close(() => {
        console.log('Servidor cerrado.');
        process.exit(0);
    });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));