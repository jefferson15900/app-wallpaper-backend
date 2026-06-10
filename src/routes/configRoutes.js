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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Registro atómico diario
        await SearchLog.findOneAndUpdate(
            { term: term, date: today },
            { $inc: { count: 1 } }, 
            { upsert: true }
        );

        res.sendStatus(200);
    } catch (err) {
        console.error("Error Tracking:", err.message);
        res.sendStatus(200); 
    }
});

router.post('/track-search-click', async (req, res) => {
    const { query, wallpaperId } = req.body;
    let rawTerm = query?.toLowerCase().trim();

    if (!rawTerm || rawTerm.length < 2) return res.sendStatus(200);

    try {
        const singular = nlp(rawTerm).nouns().toSingular().text().trim();
        const term = singular || rawTerm;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Registro atómico de click diario
        await SearchLog.findOneAndUpdate(
            { term: term, date: today },
            { $inc: { clicks: 1 } }, 
            { upsert: true }
        );

        res.sendStatus(200);
    } catch (err) {
        console.error("Error Tracking Click:", err.message);
        res.sendStatus(200); 
    }
});


module.exports = router;