const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/items.controller");

const validateMuseumId = validateObjectIdParam("museumId");
const validateItemId = validateObjectIdParam("itemId");
const base = "/museums/:museumId/items/:itemId";

router.route("/museums/:museumId/items")
  .all(validateMuseumId)
  .get(controller.listItems)
  .post(requireAuth, controller.createItem);

router.post(`${base}/check-consistency`, requireAuth, validateMuseumId, validateItemId, controller.checkItemConsistency);
router.post(`${base}/request-review`, requireAuth, validateMuseumId, validateItemId, controller.requestItemReview);
router.post(`${base}/withdraw-review`, requireAuth, validateMuseumId, validateItemId, controller.withdrawItemReview);
router.post(`${base}/request-changes`, requireAuth, validateMuseumId, validateItemId, controller.requestItemChanges);
router.post(`${base}/publish`, requireAuth, validateMuseumId, validateItemId, controller.publishItem);
router.post(`${base}/restore`, requireAuth, validateMuseumId, validateItemId, controller.restoreItem);
router.delete(`${base}/hard-delete`, requireAuth, validateMuseumId, validateItemId, controller.hardDeleteItem);

router.route(base)
  .all(validateMuseumId, validateItemId)
  .get(controller.getItem)
  .put(requireAuth, controller.updateItem)
  .patch(requireAuth, controller.updateItem)
  .delete(requireAuth, controller.trashItem);

module.exports = router;
