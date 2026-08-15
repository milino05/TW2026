const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/navigation.controller");
const validateMuseumId = validateObjectIdParam("museumId");
router.post("/museums/:museumId/navigation/route", requireAuth, validateMuseumId, controller.route);
router.post("/museums/:museumId/navigation/intent", requireAuth, validateMuseumId, controller.intent);
module.exports = router;
