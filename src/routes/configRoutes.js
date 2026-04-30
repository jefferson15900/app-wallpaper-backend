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

router.post('/track-search', async (req, res) => {
    const { query } = req.body;
    let rawTerm = query?.toLowerCase().trim();

    if (!rawTerm || rawTerm.length < 2) return res.sendStatus(200);

    try {
        const singular = nlp(rawTerm).nouns().toSingular().text().trim();
        const term = singular || rawTerm;

        // Registro atómico
        await SearchLog.findOneAndUpdate(
            { term: term },
            { $inc: { count: 1 } }, // Al incrementar, 'updatedAt' se actualiza solo
            { upsert: true }
        );

        res.sendStatus(200);
    } catch (err) {
        // Log solo para ti, el usuario no ve error
        console.error("Error Tracking:", err.message);
        res.sendStatus(200); 
    }
});


module.exports = router;