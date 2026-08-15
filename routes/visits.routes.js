const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/visits.controller");

const validateVisitId = validateObjectIdParam("visitId");
const base = "/visits/:visitId";

router.get("/visits", controller.listPublishedVisits);
router.get("/visits/mine", requireAuth, controller.listMyVisits);
router.post("/visits", requireAuth, controller.createVisit);
router.post(`${base}/check-consistency`, requireAuth, validateVisitId, controller.checkVisitConsistency);
router.post(`${base}/request-review`, requireAuth, validateVisitId, controller.requestVisitReview);
router.post(`${base}/withdraw-review`, requireAuth, validateVisitId, controller.withdrawVisitReview);
router.post(`${base}/request-changes`, requireAuth, validateVisitId, controller.requestVisitChanges);
router.post(`${base}/publish`, requireAuth, validateVisitId, controller.publishVisit);
router.post(`${base}/restore`, requireAuth, validateVisitId, controller.restoreVisit);
router.delete(`${base}/hard-delete`, requireAuth, validateVisitId, controller.hardDeleteVisit);
router.route(base)
  .all(validateVisitId)
  .get(controller.getVisit)
  .put(requireAuth, controller.updateVisit)
  .patch(requireAuth, controller.updateVisit)
  .delete(requireAuth, controller.trashVisit);

module.exports = router;
