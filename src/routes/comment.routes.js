const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth'); 
const commentController = require('../controllers/comment.controller');

router.get('/:articleId', commentController.getComments);
router.post('/', authenticate, commentController.createComment);
router.post('/:articleId/rate', authenticate, commentController.rateArticle);
router.delete('/:id', authenticate, commentController.deleteComment); 

module.exports = router;