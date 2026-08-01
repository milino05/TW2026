const express = require("express");

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const {
  createVisit,
  updateVisit,
  listPublishedVisits,
  listMyVisits,
  getVisit,
  checkVisitConsistency,
  publishVisit,
} = require("../controllers/visits.controller");

const router = express.Router();
const validateVisitId = validateObjectIdParam("visitId");

router.get("/visits", listPublishedVisits);
router.get("/visits/mine", requireAuth, listMyVisits);
router.post("/visits", requireAuth, createVisit);

router.post(
  "/visits/:visitId/check-consistency",
  requireAuth,
  validateVisitId,
  checkVisitConsistency,
);
router.post("/visits/:visitId/publish", requireAuth, validateVisitId, publishVisit);

router
  .route("/visits/:visitId")
  .all(validateVisitId)
  .get(getVisit)
  .put(requireAuth, updateVisit)
  .patch(requireAuth, updateVisit);

module.exports = router;
