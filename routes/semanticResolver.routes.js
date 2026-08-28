const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/semanticResolver.controller");

const router = express.Router();
router.use("/v2/semantic-resolver", requireAuth);
router.get("/v2/semantic-resolver/providers", controller.providers);
router.get("/v2/semantic-resolver/search", controller.search);
router.get("/v2/semantic-resolver/resolve", controller.resolve);

module.exports = router;
