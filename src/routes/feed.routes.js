const { Router } = require("express");
const followController = require("../controllers/follow.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Following feed (protected)
router.get("/following", authenticate, followController.getFollowingFeed);

module.exports = router;
