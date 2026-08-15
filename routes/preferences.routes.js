const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/preferences.controller");

const validateVisitId = validateObjectIdParam("visitId");
router.put("/users/me/presentation-preference", requireAuth, controller.setDefaultPreference);
router
  .route("/visits/:visitId/preference")
  .all(requireAuth, validateVisitId)
  .get(controller.getVisitPreference)
  .put(controller.setVisitPreference);
router.get("/visits/:visitId/preference-options", requireAuth, validateVisitId, controller.getVisitPreferenceOptions);
router.get("/visits/:visitId/presentation-plan", requireAuth, validateVisitId, controller.getPresentationPlan);
module.exports = router;
