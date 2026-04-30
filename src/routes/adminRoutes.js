const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');

router.post('/ping', async (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) return res.sendStatus(400);

    try {
        await Visitor.findOneAndUpdate(
            { deviceId }, 
            { $set: { lastActiveAt: new Date() } }, 
            { upsert: true, new: true }
        );
        res.sendStatus(200); 
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post('/broadcast', [auth, isAdmin], adminController.broadcast);
router.put('/verify-user/:userId', [auth, isAdmin], adminController.verifyUser);
router.put('/reject-verification/:userId', [auth, isAdmin], adminController.rejectVerification);
router.get('/reports', [auth, isAdmin], adminController.getReports);
router.post('/report-action', [auth, isAdmin], adminController.reportAction);
router.put('/retry-ai/:id', [auth, isAdmin], adminController.retryAITagging);
router.get('/stats', [auth, isAdmin], adminController.getDashboardStats);
router.get('/searches', [auth, isAdmin], adminController.getTopSearches);
router.delete('/searches/cleanup', [auth, isAdmin], adminController.cleanupSearchLogs);

module.exports = router; 