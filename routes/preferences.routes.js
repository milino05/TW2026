const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/preferences.controller");

const router = express.Router();
router.put("/users/me/presentation-preference", requireAuth, controller.setDefaultPreference);
router.put("/users/me/navigation-preference", requireAuth, controller.setDefaultNavigation);
router.put("/users/me/adaptive-learning", requireAuth, controller.setLearning);
router.get("/users/me/adaptive-profile", requireAuth, controller.profile);
router.delete("/users/me/adaptive-profile", requireAuth, controller.reset);

module.exports = router;
