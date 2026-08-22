const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/navigatorV2.controller");

const router = express.Router();
const visitId = validateObjectIdParam("visitId");

router.use(requireAuth);
router.get("/v2/navigator/library", controller.library);
router.get("/v2/navigator/sessions", controller.resumableSessions);
router.get("/v2/navigator/generation-options", controller.generationOptionsProjection);
router.post("/v2/navigator/generation-subjects/search", controller.generationSubjectOptions);
router.get("/v2/navigator/visits/:visitId", visitId, controller.visitDetail);

module.exports = router;