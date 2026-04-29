const express = require("express");
const router = express.Router();

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");

const { createItem, updateItem, listItems, getItem, deleteItem, getItemRelations, addItemRelation, removeItemRelation } = require("../controllers/items.controller");
const validateMuseumId = validateObjectIdParam("museumId");
const validateItemId = validateObjectIdParam("itemId");

router.route("/museums/:museumId/items").all(validateMuseumId).get(listItems).post(createItem);

router.route("/museums/:museumId/items/:itemId").all(validateMuseumId, validateItemId).get(getItem).put(updateItem).patch(updateItem).delete(deleteItem);

module.exports = router;
