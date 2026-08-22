const express = require("express");
const { requireAuth } = require("../middlewares/auth");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const controller = require("../controllers/marketplaceV2.controller");

const router = express.Router();
const listingId = validateObjectIdParam("listingId");
const offerId = validateObjectIdParam("offerId");

router.use(requireAuth);
router.get("/v2/marketplace/catalog", controller.catalog);
router.get("/v2/marketplace/acquisitions", controller.acquisitionHistory);
router.get("/v2/marketplace/workspace", controller.creatorWorkspace);
router.get("/v2/marketplace/distribution", controller.distributionDashboard);
router.post("/v2/marketplace/listings", controller.createListing);
router.get("/v2/marketplace/listings/:listingId", listingId, controller.detail);
router.post("/v2/marketplace/listings/:listingId/offers", listingId, controller.createOffer);
router.post("/v2/marketplace/offers/:offerId/acquire", offerId, controller.acquire);

module.exports = router;
