const { Router } = require("express");
const statsController = require("../controllers/stats.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// All stats routes are protected
router.use(authenticate);

router.get("/", statsController.getMyStats);
router.get("/top-articles", statsController.getTopArticles);
router.get("/analytics", statsController.getAnalytics);
router.post("/recalculate", statsController.recalculate);
router.get("/:userId", statsController.getUserStats);

module.exports = router;
