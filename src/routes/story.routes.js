const { Router } = require("express");
const storyController = require("../controllers/story.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// All story routes are protected
router.use(authenticate);

router.post("/", storyController.createStory);
router.get("/", storyController.getStories);
router.delete("/:id", storyController.deleteStory);

module.exports = router;
