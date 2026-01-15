require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');

const app = express();

// Middlewares
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