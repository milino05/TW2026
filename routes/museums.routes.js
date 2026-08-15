const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/museums.controller");

const validateMuseumId = validateObjectIdParam("museumId");
const validateUserId = validateObjectIdParam("userId");

router.route("/museums").get(controller.listMuseums).post(requireAuth, controller.createMuseum);
router.get("/museums/:museumId/vocabulary", validateMuseumId, controller.getEditorVocabulary);
router.get("/museums/:museumId/vocabulary/item-types/:itemType", validateMuseumId, controller.getItemTypeVocabulary);
router.get("/museums/:museumId/editor-vocabulary", validateMuseumId, controller.getEditorVocabulary);
router.post(
  "/museums/:museumId/members",
  requireAuth,
  validateMuseumId,
  controller.assignMuseumRoleByUsername,
);

router.put(
  "/museums/:museumId/members/:userId/role",
  requireAuth,
  validateMuseumId,
  validateUserId,
  controller.assignMuseumRole,
);
router.delete(
  "/museums/:museumId/members/:userId",
  requireAuth,
  validateMuseumId,
  validateUserId,
  controller.removeMuseumMember,
);
router
  .route("/museums/:museumId")
  .all(validateMuseumId)
  .get(controller.getMuseum)
  .put(requireAuth, controller.updateMuseum)
  .patch(requireAuth, controller.updateMuseum)
  .delete(requireAuth, controller.deleteMuseum);

module.exports = router;
