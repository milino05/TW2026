const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/venues.controller");

const router = express.Router();
const venueId = validateObjectIdParam("venueId");
const venueTargetId = validateObjectIdParam("venueTargetId");
const floorId = validateObjectIdParam("floorId");
const placeId = validateObjectIdParam("placeId");
const connectionId = validateObjectIdParam("connectionId");

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

router.post("/venues/:venueId/working-layout/floors", requireAuth, venueId, controller.addLayoutFloor);
router.patch("/venues/:venueId/working-layout/floors/:floorId", requireAuth, venueId, floorId, controller.updateLayoutFloor);
router.post("/venues/:venueId/working-layout/floors/:floorId/map-asset", requireAuth, venueId, floorId, controller.uploadLayoutFloorPlan);
router.put("/venues/:venueId/working-layout/floors/:floorId/calibration", requireAuth, venueId, floorId, controller.calibrateLayoutFloor);
router.delete("/venues/:venueId/working-layout/floors/:floorId", requireAuth, venueId, floorId, controller.removeLayoutFloor);

router.post("/venues/:venueId/working-layout/places", requireAuth, venueId, controller.createLayoutPlace);
router.patch("/venues/:venueId/working-layout/places/:placeId", requireAuth, venueId, placeId, controller.updateLayoutPlace);
router.patch("/venues/:venueId/working-layout/places/:placeId/position", requireAuth, venueId, placeId, controller.moveLayoutPlace);
router.put("/venues/:venueId/working-layout/places/:placeId/attributes/:definitionId", requireAuth, venueId, placeId, controller.setLayoutPlaceAttribute);
router.delete("/venues/:venueId/working-layout/places/:placeId", requireAuth, venueId, placeId, controller.removeLayoutPlace);

router.post("/venues/:venueId/working-layout/connections", requireAuth, venueId, controller.createLayoutConnection);
router.patch("/venues/:venueId/working-layout/connections/:connectionId", requireAuth, venueId, connectionId, controller.updateLayoutConnection);
router.put("/venues/:venueId/working-layout/connections/:connectionId/attributes/:definitionId", requireAuth, venueId, connectionId, controller.setLayoutConnectionAttribute);
router.delete("/venues/:venueId/working-layout/connections/:connectionId", requireAuth, venueId, connectionId, controller.removeLayoutConnection);

router.put("/venues/:venueId/working-layout/targets/:venueTargetId/placement", requireAuth, venueId, venueTargetId, controller.setLayoutTargetPlacement);
router.put("/venues/:venueId/working-layout/targets/:venueTargetId/binding", requireAuth, venueId, venueTargetId, controller.setLayoutTargetBinding);
router.put("/venues/:venueId/working-layout/pre-visit-information", requireAuth, venueId, controller.setPreVisitInformation);

module.exports = router;