const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');
const analyticsController = require('../controllers/analyticsController');
const { editPendingWallpaper } = require('../controllers/pendingReviewController');
const { uploadCloud } = require('../config/cloudinary');

router.post('/ping', analyticsController.ping);

router.post('/broadcast', [auth, isAdmin], adminController.broadcast);
router.post('/broadcast/receipts', [auth, isAdmin], adminController.broadcastReceipts);
router.get('/broadcast/history', [auth, isAdmin], adminController.broadcastHistory);
router.get('/broadcast/:requestId', [auth, isAdmin], adminController.broadcastStatus);
router.put('/verify-user/:userId', [auth, isAdmin], adminController.verifyUser);
router.put('/reject-verification/:userId', [auth, isAdmin], adminController.rejectVerification);
router.get('/reports', [auth, isAdmin], adminController.getReports);
router.post('/report-action', [auth, isAdmin], adminController.reportAction);
router.put('/retry-ai/:id', [auth, isAdmin], adminController.retryAITagging);
router.get('/stats', [auth, isAdmin], analyticsController.dashboard);
router.get('/searches', [auth, isAdmin], adminController.getTopSearches);
router.delete('/searches/cleanup', [auth, isAdmin], adminController.cleanupSearchLogs);
router.get('/pending', [auth, isAdmin], adminController.getPendingWallpapers);
router.put('/pending/:id', [auth, isAdmin], editPendingWallpaper);
router.put('/decide/:id', [auth, isAdmin], adminController.approveOrReject);
router.put('/set-premium/:id', [auth, isAdmin], adminController.togglePremium);
router.post('/verify/submit', [auth, uploadCloud.array('image', 4)], adminController.submitVerification);
router.put('/verify/clear-notification', auth, adminController.clearVerificationNotification);
router.post('/verify/resolve', [auth, isAdmin], adminController.resolveVerification);
router.get('/verify/requests', [auth, isAdmin], adminController.getVerificationRequests);


module.exports = router;
