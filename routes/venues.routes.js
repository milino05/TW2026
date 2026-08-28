const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/venues.controller");

const router = express.Router();
const venueId = validateObjectIdParam("venueId");
const venueTargetId = validateObjectIdParam("venueTargetId");

router.get("/venues", controller.list);
router.post("/venues", requireAuth, controller.create);
router.get("/venues/:venueId", venueId, controller.get);
router.patch("/venues/:venueId", requireAuth, venueId, controller.update);

router.get("/venues/:venueId/targets", venueId, controller.listTargets);
router.post("/venues/:venueId/targets", requireAuth, venueId, controller.createTarget);
router.patch("/venues/:venueId/targets/:venueTargetId", requireAuth, venueId, venueTargetId, controller.updateTarget);
router.delete("/venues/:venueId/targets/:venueTargetId", requireAuth, venueId, venueTargetId, controller.trashTarget);

router.get("/venues/:venueId/physical-state", venueId, controller.getPhysicalState);
router.get("/venues/:venueId/physical-onboarding", requireAuth, venueId, controller.getPhysicalOnboarding);
router.post("/venues/:venueId/physical-onboarding", requireAuth, venueId, controller.initializePhysicalOnboarding);
router.post("/venues/:venueId/working-release", requireAuth, venueId, controller.ensureWorkingRelease);
router.patch("/venues/:venueId/working-release", requireAuth, venueId, controller.updateWorkingRelease);
router.post("/venues/:venueId/working-release/check-consistency", requireAuth, venueId, controller.checkRelease);
router.post("/venues/:venueId/working-release/review", requireAuth, venueId, controller.submitReleaseReview);
router.delete("/venues/:venueId/working-release/review", requireAuth, venueId, controller.withdrawReleaseReview);
router.post("/venues/:venueId/working-release/request-changes", requireAuth, venueId, controller.requestReleaseChanges);
router.post("/venues/:venueId/working-release/publish", requireAuth, venueId, controller.publishRelease);

module.exports = router;
