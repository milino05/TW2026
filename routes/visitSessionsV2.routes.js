const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/visitSessionsV2.controller");
const validateSessionId = validateObjectIdParam("sessionId");

router.get("/v2/visit-sessions/:sessionId/current", requireAuth, validateSessionId, controller.current);
router.get("/v2/visit-sessions/:sessionId/plan", requireAuth, validateSessionId, controller.currentPlan);
router.post("/v2/visit-sessions/:sessionId/advance", requireAuth, validateSessionId, controller.advance);
router.post("/v2/visit-sessions/:sessionId/presentation-depth", requireAuth, validateSessionId, controller.presentationDepth);
router.post("/v2/visit-sessions/:sessionId/presentation-language", requireAuth, validateSessionId, controller.presentationLanguage);
router.post("/v2/visit-sessions/:sessionId/content-entries/experience", requireAuth, validateSessionId, controller.contentExperience);
router.post("/v2/visit-sessions/:sessionId/visit-anchors/observation", requireAuth, validateSessionId, controller.targetObservation);
router.post("/v2/visit-sessions/:sessionId/transitions", requireAuth, validateSessionId, controller.transition);
router.post("/v2/visit-sessions/:sessionId/route-to-intent", requireAuth, validateSessionId, controller.routeToIntent);
router.post("/v2/visit-sessions/:sessionId/pause", requireAuth, validateSessionId, controller.pause);
router.post("/v2/visit-sessions/:sessionId/resume", requireAuth, validateSessionId, controller.resume);
router.post("/v2/visit-sessions/:sessionId/complete", requireAuth, validateSessionId, controller.complete);

module.exports = router;
