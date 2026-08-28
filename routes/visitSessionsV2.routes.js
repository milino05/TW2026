const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/visitSessionsV2.controller");
const validateSessionId = validateObjectIdParam("sessionId");

router.get("/v2/visit-sessions/:sessionId/current", requireAuth, validateSessionId, controller.current);
router.get("/v2/visit-sessions/:sessionId/map", requireAuth, validateSessionId, controller.map);
router.post("/v2/visit-sessions/:sessionId/actions", requireAuth, validateSessionId, controller.dispatchAction);

// Location providers resolve external observations to the logical position pinned by the Session.
// Resolving a public code does not mutate or reposition the Session by itself.
router.post("/v2/visit-sessions/:sessionId/location/resolve-public-code", requireAuth, validateSessionId, controller.resolvePublicLocation);

// Telemetry/observations are not runtime Actions and remain explicit application boundaries.
router.post("/v2/visit-sessions/:sessionId/content-entries/experience", requireAuth, validateSessionId, controller.contentExperience);
router.post("/v2/visit-sessions/:sessionId/visit-anchors/observation", requireAuth, validateSessionId, controller.targetObservation);
router.post("/v2/visit-sessions/:sessionId/transitions", requireAuth, validateSessionId, controller.transition);

module.exports = router;
