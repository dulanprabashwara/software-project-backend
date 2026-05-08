//imports
const express = require("express");
const router = express.Router();
const homefeedController = require("../controllers/homefeed.controller"); //impprt controller
const { authenticate } = require("../middlewares/auth"); //user authentication import

router.use(authenticate); //check if user is logged in

// homefeed routes
router.get("/main", homefeedController.getMainFeed); //New feed
router.get("/following", homefeedController.getFollowingFeed); //following feed
 

module.exports = router;