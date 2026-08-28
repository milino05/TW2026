const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/physicalVocabularies.controller");

const validatePhysicalVocabularyId = validateObjectIdParam("physicalVocabularyId");

router.route("/physical-vocabularies")
  .get(requireAuth, controller.list)
  .post(requireAuth, controller.create);

router.post("/physical-vocabularies/:physicalVocabularyId/fork", requireAuth, validatePhysicalVocabularyId, controller.fork);
router.get("/physical-vocabularies/:physicalVocabularyId/revision", validatePhysicalVocabularyId, controller.getPublishedRevision);
router.get("/physical-vocabularies/:physicalVocabularyId/working-revision", requireAuth, validatePhysicalVocabularyId, controller.getWorkingRevision);
router.patch("/physical-vocabularies/:physicalVocabularyId/working-revision", requireAuth, validatePhysicalVocabularyId, controller.updateWorkingRevision);
router.put("/physical-vocabularies/:physicalVocabularyId/working-revision", requireAuth, validatePhysicalVocabularyId, controller.updateWorkingRevision);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/apply-starter", requireAuth, validatePhysicalVocabularyId, controller.applyStarter);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/check-consistency", requireAuth, validatePhysicalVocabularyId, controller.check);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/request-review", requireAuth, validatePhysicalVocabularyId, controller.requestReview);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/withdraw-review", requireAuth, validatePhysicalVocabularyId, controller.withdrawReview);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/request-changes", requireAuth, validatePhysicalVocabularyId, controller.requestChanges);
router.post("/physical-vocabularies/:physicalVocabularyId/working-revision/publish", requireAuth, validatePhysicalVocabularyId, controller.publish);
router.post("/physical-vocabularies/:physicalVocabularyId/lifecycle/trash", requireAuth, validatePhysicalVocabularyId, controller.trash);
router.post("/physical-vocabularies/:physicalVocabularyId/lifecycle/restore", requireAuth, validatePhysicalVocabularyId, controller.restore);

router.route("/physical-vocabularies/:physicalVocabularyId")
  .all(validatePhysicalVocabularyId)
  .get(controller.get)
  .put(requireAuth, controller.update)
  .patch(requireAuth, controller.update);

module.exports = router;
