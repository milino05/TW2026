const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/venues.controller");
const lifecycleController = require("../controllers/venueLifecycle.controller");
const inventoryProposalController = require("../controllers/venueInventoryProposals.controller");

const router = express.Router();
const venueId = validateObjectIdParam("venueId");
const venueTargetId = validateObjectIdParam("venueTargetId");
const proposalId = validateObjectIdParam("proposalId");
const mediaId = validateObjectIdParam("mediaId");
const floorId = validateObjectIdParam("floorId");
const placeId = validateObjectIdParam("placeId");
const connectionId = validateObjectIdParam("connectionId");
const exhibitSlotId = validateObjectIdParam("exhibitSlotId");
const resourceId = validateObjectIdParam("resourceId");

router.get("/physical-locations/:publicCode", controller.resolvePublishedPublicLocation);
router.get("/venues", controller.list);
router.post("/venues", requireAuth, controller.create);
router.get("/venues/:venueId", venueId, controller.get);
router.patch("/venues/:venueId", requireAuth, venueId, controller.update);
router.get("/venues/:venueId/subject-candidates", requireAuth, venueId, controller.searchSubjectCandidates);
router.get("/venues/:venueId/lifecycle-impact", requireAuth, venueId, lifecycleController.impact);
router.post("/venues/:venueId/lifecycle/trash", requireAuth, venueId, lifecycleController.trash);
router.post("/venues/:venueId/lifecycle/restore", requireAuth, venueId, lifecycleController.restore);

router.get("/venues/:venueId/targets", venueId, controller.listTargets);
router.post("/venues/:venueId/targets", requireAuth, venueId, controller.createTarget);
router.patch("/venues/:venueId/targets/:venueTargetId", requireAuth, venueId, venueTargetId, controller.updateTarget);
router.delete("/venues/:venueId/targets/:venueTargetId", requireAuth, venueId, venueTargetId, controller.trashTarget);

router.get("/venues/:venueId/inventory-proposals", requireAuth, venueId, inventoryProposalController.list);
router.post("/venues/:venueId/inventory-proposals", requireAuth, venueId, inventoryProposalController.submit);
router.post("/venues/:venueId/inventory-proposals/:proposalId/accept", requireAuth, venueId, proposalId, inventoryProposalController.accept);
router.post("/venues/:venueId/inventory-proposals/:proposalId/reject", requireAuth, venueId, proposalId, inventoryProposalController.reject);
router.post("/venues/:venueId/inventory-proposals/:proposalId/withdraw", requireAuth, venueId, proposalId, inventoryProposalController.withdraw);

router.get("/venues/:venueId/physical-state", venueId, controller.getPhysicalState);
router.get("/venues/:venueId/physical-onboarding", requireAuth, venueId, controller.getPhysicalOnboarding);
router.post("/venues/:venueId/physical-onboarding", requireAuth, venueId, controller.initializePhysicalOnboarding);
router.post("/venues/:venueId/working-release", requireAuth, venueId, controller.ensureWorkingRelease);
router.post("/venues/:venueId/working-release/check-consistency", requireAuth, venueId, controller.checkRelease);
router.post("/venues/:venueId/working-release/review", requireAuth, venueId, controller.submitReleaseReview);
router.delete("/venues/:venueId/working-release/review", requireAuth, venueId, controller.withdrawReleaseReview);
router.post("/venues/:venueId/working-release/request-changes", requireAuth, venueId, controller.requestReleaseChanges);
router.post("/venues/:venueId/working-release/publish", requireAuth, venueId, controller.publishRelease);
router.delete("/venues/:venueId/working-release/targets/:venueTargetId", requireAuth, venueId, venueTargetId, controller.detachTargetFromWorkingConfiguration);
router.put("/venues/:venueId/working-release/targets/:venueTargetId/availability", requireAuth, venueId, venueTargetId, controller.setTargetAvailability);
router.post("/venues/:venueId/working-release/targets/:venueTargetId/recognition-media", requireAuth, venueId, venueTargetId, controller.uploadTargetRecognitionMedia);
router.delete("/venues/:venueId/working-release/targets/:venueTargetId/recognition-media/:mediaId", requireAuth, venueId, venueTargetId, mediaId, controller.removeTargetRecognitionMedia);

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

router.post("/venues/:venueId/working-layout/exhibit-slots", requireAuth, venueId, controller.createLayoutExhibitSlot);
router.patch("/venues/:venueId/working-layout/exhibit-slots/:exhibitSlotId", requireAuth, venueId, exhibitSlotId, controller.updateLayoutExhibitSlot);
router.delete("/venues/:venueId/working-layout/exhibit-slots/:exhibitSlotId", requireAuth, venueId, exhibitSlotId, controller.removeLayoutExhibitSlot);
router.put("/venues/:venueId/working-layout/exhibit-slots/:exhibitSlotId/entity/:venueTargetId", requireAuth, venueId, exhibitSlotId, venueTargetId, controller.assignTargetToExhibitSlot);
router.delete("/venues/:venueId/working-layout/entities/:venueTargetId/exhibit-slot", requireAuth, venueId, venueTargetId, controller.unassignTargetFromExhibitSlot);
router.get("/venues/:venueId/working-layout/removal-impact/:resourceType/:resourceId", requireAuth, venueId, resourceId, controller.getLayoutRemovalImpact);
router.put("/venues/:venueId/working-layout/pre-visit-information", requireAuth, venueId, controller.setPreVisitInformation);

module.exports = router;