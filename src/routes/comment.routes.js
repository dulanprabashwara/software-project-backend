const express = require('express');
const router = express.Router();
// Import the new middleware file
const { authenticate } = require('../middlewares/auth'); 
const commentController = require('../controllers/comment.controller');

// GET comments is usually public
router.get('/:articleId', commentController.getComments);

// POST comments REQUIRES authentication
// Using 'authenticate' here populates req.user with your Postgres user
router.post('/', authenticate, commentController.createComment);

// POST rating REQUIRES authentication
router.post('/:articleId/rate', authenticate, commentController.rateArticle);

module.exports = router;