const express = require("express");
const router = express.Router();

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");

const { createItem, updateItem, listItems, getItem, deleteItem, getEditorVocabulary } = require("../controllers/items.controller");

router.get("/museums/:museumId/editor-vocabulary", validateObjectIdParam("museumId"), getEditorVocabulary);

router.route("/museums/:museumId/items").all(validateObjectIdParam("museumId")).get(listItems).post(createItem);

router.route("/museums/:museumId/items/:itemId").all(validateObjectIdParam("museumId"), validateObjectIdParam("itemId")).get(getItem).put(updateItem).patch(updateItem).delete(deleteItem);

module.exports = router;
