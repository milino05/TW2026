const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/contentSpaces.controller");
const router = express.Router();
const contentSpaceId = validateObjectIdParam("contentSpaceId");
const itemId = validateObjectIdParam("itemId");

router.use(requireAuth);
router.route("/content-spaces")
  .get(controller.list)
  .post(controller.create);

router.get("/content-spaces/:contentSpaceId/items", contentSpaceId, controller.listItems);
router.put("/content-spaces/:contentSpaceId/items/:itemId", contentSpaceId, itemId, controller.addItem);
router.delete("/content-spaces/:contentSpaceId/items/:itemId", contentSpaceId, itemId, controller.removeItem);
router.post("/content-spaces/:contentSpaceId/items/:itemId/move", contentSpaceId, itemId, controller.moveItem);

router.route("/content-spaces/:contentSpaceId")
  .all(contentSpaceId)
  .get(controller.get)
  .patch(controller.update);

module.exports = router;
