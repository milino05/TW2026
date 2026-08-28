const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/visitsV2.controller");

const router = express.Router();
const visitId = validateObjectIdParam("visitId");
const anchorId = validateObjectIdParam("anchorId");
const contentEntryId = validateObjectIdParam("contentEntryId");

router.use(requireAuth);
router.route("/v2/visits")
  .get(controller.list)
  .post(controller.create);

router.route("/v2/visits/:visitId")
  .all(visitId)
  .get(controller.get)
  .patch(controller.update);

router.post("/v2/visits/:visitId/commands/content", visitId, controller.addContentToVisit);
router.post("/v2/visits/:visitId/commands/stops", visitId, controller.addVisitStop);
router.post("/v2/visits/:visitId/commands/stops/:anchorId/content", visitId, anchorId, controller.addContentToStop);
router.post("/v2/visits/:visitId/commands/stops/:anchorId/reorder", visitId, anchorId, controller.reorderVisitStop);
router.delete("/v2/visits/:visitId/commands/stops/:anchorId", visitId, anchorId, controller.removeVisitStop);
router.put("/v2/visits/:visitId/commands/content/:contentEntryId/stop/:anchorId", visitId, contentEntryId, anchorId, controller.attachContentToStop);
router.delete("/v2/visits/:visitId/commands/content/:contentEntryId/stop", visitId, contentEntryId, controller.detachContentFromStop);
router.put("/v2/visits/:visitId/commands/content/:contentEntryId/role", visitId, contentEntryId, controller.setContentRole);
router.delete("/v2/visits/:visitId/commands/content/:contentEntryId", visitId, contentEntryId, controller.removeContentFromVisit);

router.post("/v2/visits/:visitId/copy", visitId, controller.copy);
router.post("/v2/visits/:visitId/check", visitId, controller.check);
router.post("/v2/visits/:visitId/review/request", visitId, controller.requestReview);
router.post("/v2/visits/:visitId/review/withdraw", visitId, controller.withdrawReview);
router.post("/v2/visits/:visitId/review/changes", visitId, controller.requestChanges);
router.post("/v2/visits/:visitId/publish", visitId, controller.publish);
router.post("/v2/visits/:visitId/trash", visitId, controller.trash);
router.post("/v2/visits/:visitId/restore", visitId, controller.restore);

module.exports = router;