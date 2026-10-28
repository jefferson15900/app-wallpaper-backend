const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

// Readiness includes MongoDB: the app must be able to load its content.
router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ ready: false });
        }
        await mongoose.connection.db.admin().ping({ timeoutMS: 5000 });
        return res.json({ ready: true });
    } catch {
        return res.status(503).json({ ready: false });
    }
});

module.exports = router;
