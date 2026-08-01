const express = require("express");
const router = express.Router();

const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");

const {
  createItem,
  updateItem,
  listItems,
  getItem,
  checkItemConsistency,
  publishItem,
  deleteItem,
} = require("../controllers/items.controller");

const validateMuseumId = validateObjectIdParam("museumId");
const validateItemId = validateObjectIdParam("itemId");

router
  .route("/museums/:museumId/items")
  .all(validateMuseumId)
  .get(listItems)
  .post(requireAuth, createItem);

router.post(
  "/museums/:museumId/items/:itemId/check-consistency",
  requireAuth,
  validateMuseumId,
  validateItemId,
  checkItemConsistency,
);

router.post(
  "/museums/:museumId/items/:itemId/publish",
  requireAuth,
  validateMuseumId,
  validateItemId,
  publishItem,
);

router
  .route("/museums/:museumId/items/:itemId")
  .all(validateMuseumId, validateItemId)
  .get(getItem)
  .put(requireAuth, updateItem)
  .patch(requireAuth, updateItem)
  .delete(requireAuth, deleteItem);

module.exports = router;
