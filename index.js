require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // 👈 Necesario para leer los archivos
const connectDB = require('./src/config/db.js');
const compression = require('compression');
const configRoutes = require('./src/routes/configRoutes');

const app = express();
app.set('trust proxy', 1);

// 1. SERVIR ARCHIVOS ESTÁTICOS 🚀
// Esto sirve automáticamente robots.txt y app-ads.txt si están en /public
app.use(express.static('public'));

// 2. MIDDLEWARES GLOBALES
app.use(compression());
app.use(cors());
app.use(express.json());

// 3. RUTAS PARA PÁGINAS LEGALES (Usando los archivos que creaste)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/delete-account', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'support.html'));
});

// 4. CONEXIÓN A DB Y RUTAS DE API
connectDB();
app.use('/api/auth', require('./src/routes/authRoutes')); 
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/wallpapers', require('./src/routes/wallpaperRoutes'));
app.use('/api/feedback', require('./src/routes/feedbackRoutes'));
app.use('/api/coins', require('./src/routes/coinRoutes'));
app.use('/api/config', configRoutes);

// 5. MANEJADOR DE ERRORES GLOBAL
app.use((err, req, res, next) => {
    const status = err.statusCode ?? 500;
    console.error(`[${req.method}] ${req.path} → ${err.message}`);
    res.status(status).json({ msg: 'Internal Server Error' });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));

// CIERRE LIMPIO
const shutdown = (signal) => {
    server.close(() => { process.exit(0); });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));