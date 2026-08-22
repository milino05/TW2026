const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/marketplaceV2.controller");
const authoringController = require("../controllers/marketplaceAuthoringV2.controller");

const router = express.Router();
const listingId = validateObjectIdParam("listingId");
const offerId = validateObjectIdParam("offerId");
const itemId = validateObjectIdParam("itemId");
const namespaceId = validateObjectIdParam("namespaceId");
const editorialContextId = validateObjectIdParam("editorialContextId");
const editorialReleaseId = validateObjectIdParam("editorialReleaseId");
const venueId = validateObjectIdParam("venueId");
const venueTargetId = validateObjectIdParam("venueTargetId");
const visitId = validateObjectIdParam("visitId");

router.use(requireAuth);
router.get("/v2/marketplace/catalog", controller.catalog);
router.get("/v2/marketplace/venue-selector", controller.venueSelector);
router.get("/v2/marketplace/venues/:venueId/authoring-targets", venueId, authoringController.venueAuthoringTargets);
router.get("/v2/marketplace/item-authoring/:itemId", itemId, controller.itemAuthoringProjection);
router.get("/v2/marketplace/namespace-authoring/:namespaceId", namespaceId, controller.namespaceAuthoringControls);
router.get("/v2/marketplace/editorial-contexts/:editorialContextId/release-composer", editorialContextId, authoringController.editorialReleaseComposer);
router.get("/v2/marketplace/visit-authoring/new", authoringController.newVisitAuthoring);
router.get("/v2/marketplace/visit-authoring/releases/:editorialReleaseId/content", editorialReleaseId, authoringController.visitAuthoringContent);
router.get("/v2/marketplace/visit-authoring/:visitId", visitId, authoringController.visitAuthoring);
router.get("/v2/marketplace/venue-targets/:venueTargetId/authoring-context", venueTargetId, controller.venueTargetAuthoringContext);
router.get("/v2/marketplace/acquisitions", controller.acquisitionHistory);
router.get("/v2/marketplace/workspace", controller.creatorWorkspace);
router.get("/v2/marketplace/distribution", controller.distributionDashboard);
router.post("/v2/marketplace/workspace/operations", controller.workspaceOperation);
router.post("/v2/marketplace/listings", controller.createListing);
router.get("/v2/marketplace/listings/:listingId", listingId, controller.detail);
router.post("/v2/marketplace/listings/:listingId/offers", listingId, controller.createOffer);
router.post("/v2/marketplace/offers/:offerId/acquire", offerId, controller.acquire);

module.exports = router;
