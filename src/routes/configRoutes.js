const express = require('express');
const router = express.Router();
const { IGNORED_TAGS, SCORING_RULES } = require('../config/scoring');
const nlp = require('compromise');
const SearchLog = require('../models/SearchLog');

// @route   GET /api/config/scoring
// @desc    Entrega la configuración oficial del algoritmo de ADN
router.get('/scoring', (req, res) => {
    try {
        res.json({
            ignoredTags: IGNORED_TAGS, 
            rules: SCORING_RULES
        });
    } catch (err) {
        console.error("Error al cargar config de scoring:", err);
        res.status(500).send('Error del servidor');
    }
});

// @route   POST /api/config/track-search
// @desc    Registra lo que el usuario escribe en el buscador
router.post('/track-search', async (req, res) => {
    const { query } = req.body;
    
    // 1. Limpieza básica
    let rawTerm = query?.toLowerCase().trim();

    // Ignoramos búsquedas vacías o de una sola letra (ruido)
    if (!rawTerm || rawTerm.length < 2) return res.sendStatus(200);

    try {
        // 2. Unificación por NLP (Singularización)
        // Esto hace que "Gokus" y "Goku" cuenten como lo mismo
        const singular = nlp(rawTerm).nouns().toSingular().text().trim();
        const term = singular || rawTerm;

        // 3. Registro atómico en la DB
        // findOneAndUpdate con upsert: true es la forma más rápida de contar
        await SearchLog.findOneAndUpdate(
            { term: term },
            { 
                $inc: { count: 1 }, 
                $set: { lastSearchedAt: new Date() } 
            },
            { upsert: true, new: true }
        );

        res.sendStatus(200); // Respondemos rápido
    } catch (err) {
        // No bloqueamos la app por un error de analíticas
        console.error("Error al rastrear búsqueda:", err.message);
        res.sendStatus(200); 
    }
});


module.exports = router;