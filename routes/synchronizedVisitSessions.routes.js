const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/synchronizedVisitSessions.controller");

const router = express.Router();
router.use(requireAuth);
router.post("/v2/synchronized-visit-sessions/join", controller.join);
router.get(
  "/v2/synchronized-visit-sessions/:synchronizedSessionId",
  validateObjectIdParam("synchronizedSessionId"),
  controller.current,
);
router.get(
  "/v2/synchronized-visit-sessions/:synchronizedSessionId/quiz",
  validateObjectIdParam("synchronizedSessionId"),
  controller.quizProjection,
);
router.patch(
  "/v2/synchronized-visit-sessions/:synchronizedSessionId/quiz-results/:participantUserId/evaluation",
  validateObjectIdParam("synchronizedSessionId"),
  validateObjectIdParam("participantUserId"),
  controller.confirmEvaluation,
);

module.exports = router;
