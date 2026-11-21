const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const boardController = require('../controllers/boardController');
const publicBoardController = require('../controllers/publicBoardController');
const savedBoardController = require('../controllers/savedBoardController');

// Lectura pública: nunca expone tableros privados ni la identidad de los uploaders.
router.get('/public', publicBoardController.list);
router.get('/public/:id', publicBoardController.detail);

// La biblioteca personal y las modificaciones requieren autenticación.
router.get('/saved', auth, savedBoardController.list);
router.put('/:id/save', auth, savedBoardController.save);
router.delete('/:id/save', auth, savedBoardController.remove);
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

