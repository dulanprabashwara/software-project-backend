const { Router } = require("express");
const supportController = require("../controllers/support.controller");

const router = Router();

router.post("/", supportController.createSupportRequest);

module.exports = router;
