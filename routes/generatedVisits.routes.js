const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/generatedVisits.controller");
const validateMuseumId = validateObjectIdParam("museumId");
const validatePlanId = validateObjectIdParam("planId");
const validateProposalId = validateObjectIdParam("proposalId");

router.post("/museums/:museumId/generated-plans", requireAuth, validateMuseumId, controller.generate);
router.get("/generated-plans/:planId", requireAuth, validatePlanId, controller.get);
router.post("/generated-plans/:planId/accept", requireAuth, validatePlanId, controller.accept);
router.post("/generated-plans/:planId/start", requireAuth, validatePlanId, controller.start);
router.post("/generated-plans/:planId/replan-proposals", requireAuth, validatePlanId, controller.proposeReplan);
router.post("/replan-proposals/:proposalId/accept", requireAuth, validateProposalId, controller.acceptReplan);
router.post("/replan-proposals/:proposalId/reject", requireAuth, validateProposalId, controller.rejectReplan);

module.exports = router;
