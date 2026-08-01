const express = require("express");
const router = express.Router();

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");

const {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  listMuseums,
  getMuseum,
  deleteMuseum,
  getEditorVocabulary,
  getItemTypeVocabulary,
} = require("../controllers/museums.controller");

const validateMuseumId = validateObjectIdParam("museumId");
const validateUserId = validateObjectIdParam("userId");

router.route("/museums").get(listMuseums).post(requireAuth, createMuseum);

router.get("/museums/:museumId/vocabulary", validateMuseumId, getEditorVocabulary);
router.get(
  "/museums/:museumId/vocabulary/item-types/:itemType",
  validateMuseumId,
  getItemTypeVocabulary,
);
router.get("/museums/:museumId/editor-vocabulary", validateMuseumId, getEditorVocabulary);

router.put(
  "/museums/:museumId/members/:userId/role",
  requireAuth,
  validateMuseumId,
  validateUserId,
  assignMuseumRole,
);

router
  .route("/museums/:museumId")
  .all(validateMuseumId)
  .get(getMuseum)
  .put(requireAuth, updateMuseum)
  .patch(requireAuth, updateMuseum)
  .delete(requireAuth, deleteMuseum);

module.exports = router;
