const express = require('express');
const router = express.Router();
const { IGNORED_TAGS, SCORING_RULES } = require('../config/scoring');

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

module.exports = router;