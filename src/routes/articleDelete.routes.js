const express = require("express");
const router = express.Router();

const { deleteArticle } = require("../controllers/articleDelete.controller");
const { authenticate } = require("../middlewares/auth"); 

// DELETE /api/articles/:id 
router.delete("/:id", authenticate, deleteArticle);

module.exports = router;