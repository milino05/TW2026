const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/namespaces.controller");

const validateNamespaceId = validateObjectIdParam("namespaceId");

router.route("/namespaces")
  .get(controller.list)
  .post(requireAuth, controller.create);

router.post("/namespaces/:namespaceId/fork", requireAuth, validateNamespaceId, controller.fork);
router.get("/namespaces/:namespaceId/revision", validateNamespaceId, controller.getPublishedRevision);
router.get("/namespaces/:namespaceId/working-revision", requireAuth, validateNamespaceId, controller.getWorkingRevision);
router.patch("/namespaces/:namespaceId/working-revision", requireAuth, validateNamespaceId, controller.updateWorkingRevision);
router.put("/namespaces/:namespaceId/working-revision", requireAuth, validateNamespaceId, controller.updateWorkingRevision);
router.post("/namespaces/:namespaceId/working-revision/check-consistency", requireAuth, validateNamespaceId, controller.check);
router.post("/namespaces/:namespaceId/working-revision/request-review", requireAuth, validateNamespaceId, controller.requestReview);
router.post("/namespaces/:namespaceId/working-revision/withdraw-review", requireAuth, validateNamespaceId, controller.withdrawReview);
router.post("/namespaces/:namespaceId/working-revision/request-changes", requireAuth, validateNamespaceId, controller.requestChanges);
router.post("/namespaces/:namespaceId/working-revision/publish", requireAuth, validateNamespaceId, controller.publish);

router.route("/namespaces/:namespaceId")
  .all(validateNamespaceId)
  .get(controller.get)
  .put(requireAuth, controller.update)
  .patch(requireAuth, controller.update);

module.exports = router;
