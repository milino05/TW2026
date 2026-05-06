const express = require("express");
const router = express.Router();

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");

const {
  createMuseum,
  updateMuseum,
  listMuseums,
  getMuseum,
  deleteMuseum,
  getEditorVocabulary,
  getItemTypeVocabulary,
} = require("../controllers/museums.controller");

const validateMuseumId = validateObjectIdParam("museumId");

router.route("/museums").get(listMuseums).post(createMuseum);

router.get("/museums/:museumId/vocabulary", validateMuseumId, getEditorVocabulary);
router.get("/museums/:museumId/vocabulary/item-types/:itemType", validateMuseumId, getItemTypeVocabulary);
router.get("/museums/:museumId/editor-vocabulary", validateMuseumId, getEditorVocabulary);

router.route("/museums/:museumId").all(validateMuseumId).get(getMuseum).put(updateMuseum).patch(updateMuseum).delete(deleteMuseum);

module.exports = router;
