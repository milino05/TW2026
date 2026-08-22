const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/generatedVisitsV2.controller");

const validatePlanId = validateObjectIdParam("planId");
router.post("/v2/generated-plans", requireAuth, controller.generate);
router.get("/v2/generated-plans/:planId", requireAuth, validatePlanId, controller.get);
router.post("/v2/generated-plans/:planId/accept", requireAuth, validatePlanId, controller.accept);
router.post("/v2/generated-plans/:planId/materialize", requireAuth, validatePlanId, controller.materialize);

module.exports = router;
