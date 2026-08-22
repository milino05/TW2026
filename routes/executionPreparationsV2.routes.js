const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/executionPreparationsV2.controller");

const router = express.Router();
const preparationId = validateObjectIdParam("preparationId");

router.use(requireAuth);
router.post("/v2/execution-preparations", controller.create);
router.get("/v2/execution-preparations/:preparationId", preparationId, controller.get);
router.patch("/v2/execution-preparations/:preparationId", preparationId, controller.update);
router.post("/v2/execution-preparations/:preparationId/start", preparationId, controller.start);

module.exports = router;
