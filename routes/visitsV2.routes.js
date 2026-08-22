const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/visitsV2.controller");

const router = express.Router();
const visitId = validateObjectIdParam("visitId");

router.use(requireAuth);
router.route("/v2/visits")
  .get(controller.list)
  .post(controller.create);

router.route("/v2/visits/:visitId")
  .all(visitId)
  .get(controller.get)
  .patch(controller.update);

router.post("/v2/visits/:visitId/copy", visitId, controller.copy);
router.post("/v2/visits/:visitId/check", visitId, controller.check);
router.post("/v2/visits/:visitId/review/request", visitId, controller.requestReview);
router.post("/v2/visits/:visitId/review/withdraw", visitId, controller.withdrawReview);
router.post("/v2/visits/:visitId/review/changes", visitId, controller.requestChanges);
router.post("/v2/visits/:visitId/publish", visitId, controller.publish);
router.post("/v2/visits/:visitId/trash", visitId, controller.trash);
router.post("/v2/visits/:visitId/restore", visitId, controller.restore);

module.exports = router;
