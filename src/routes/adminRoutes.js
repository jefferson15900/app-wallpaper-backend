const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');


router.post('/broadcast', [auth, isAdmin], adminController.broadcast);
router.put('/verify-user/:userId', [auth, isAdmin], adminController.verifyUser);
router.put('/reject-verification/:userId', [auth, isAdmin], adminController.rejectVerification);
router.get('/reports', [auth, isAdmin], adminController.getReports);
router.post('/report-action', [auth, isAdmin], adminController.reportAction);

module.exports = router;