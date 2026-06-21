const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const boardController = require('../controllers/boardController');

// Todas las rutas de tableros requieren autenticación
router.post('/', auth, boardController.createBoard);
router.get('/', auth, boardController.getUserBoards);
router.get('/:id', auth, boardController.getBoardById);
router.put('/:id/add/:wallpaperId', auth, boardController.addWallpaperToBoard);
router.put('/:id/add-multiple', auth, boardController.addMultipleWallpapersToBoard);
router.put('/:id/remove/:wallpaperId', auth, boardController.removeWallpaperFromBoard);
router.put('/:id', auth, boardController.updateBoard);
router.put('/:targetId/merge/:sourceId', auth, boardController.mergeBoards);
router.delete('/:id', auth, boardController.deleteBoard);

module.exports = router;

