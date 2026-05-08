//comments, rating related routes
const express = require('express');
const router = express.Router();
 const { authenticate } = require('../middlewares/auth'); 
const commentController = require('../controllers/comment.controller');

 router.get('/:articleId', commentController.getComments); //get all the comments

 
router.post('/', authenticate, commentController.createComment); //post a comment

 router.post('/:articleId/rate', authenticate, commentController.rateArticle); //give a rating

module.exports = router;