const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/editorialContexts.controller");
const router = express.Router();
const editorialContextId = validateObjectIdParam("editorialContextId");

router.use(requireAuth);
router.route("/editorial-contexts")
  .get(controller.list)
  .post(controller.create);

router.route("/editorial-contexts/:editorialContextId")
  .all(editorialContextId)
  .get(controller.get)
  .patch(controller.update);

module.exports = router;
