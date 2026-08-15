const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/vocabulary.controller");
const validateMuseumId = validateObjectIdParam("museumId");

router.get("/museums/:museumId/semantic-vocabulary", validateMuseumId, controller.get);
router.put("/museums/:museumId/semantic-vocabulary", requireAuth, validateMuseumId, controller.update);
router.patch("/museums/:museumId/semantic-vocabulary", requireAuth, validateMuseumId, controller.update);
router.post("/museums/:museumId/semantic-vocabulary/check-consistency", requireAuth, validateMuseumId, controller.check);
router.post("/museums/:museumId/semantic-vocabulary/request-review", requireAuth, validateMuseumId, controller.requestReview);
router.post("/museums/:museumId/semantic-vocabulary/withdraw-review", requireAuth, validateMuseumId, controller.withdrawReview);
router.post("/museums/:museumId/semantic-vocabulary/request-changes", requireAuth, validateMuseumId, controller.requestChanges);
router.post("/museums/:museumId/semantic-vocabulary/publish", requireAuth, validateMuseumId, controller.publish);

module.exports = router;
