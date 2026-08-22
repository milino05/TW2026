const marketplace = require("../services/marketplaceV2.service");
const visitMarketplace = require("../services/marketplaceVisitV2.service");
const workspace = require("../services/marketplaceWorkspaceV2.service");

function projectAcquisitionResult(result) {
  return {
    acquisition: {
      id: result.acquisition._id,
      acquiredAt: result.acquisition.acquiredAt,
      pricing: result.acquisition.pricingSnapshot,
      alreadyAcquired: result.alreadyAcquired,
    },
    grantedUses: (result.entitlements || []).map((entitlement) => ({
      resourceType: entitlement.resourceType,
      resourceId: entitlement.resourceId,
      capability: entitlement.capability,
      versionPolicy: entitlement.versionPolicy,
      baselineSnapshotRef: entitlement.baselineSnapshotRef || null,
    })),
  };
}

async function catalog(req, res, next) {
  try {
    const resourceTypes = req.query?.resourceTypes || req.query?.resourceType || null;
    const queryText = String(req.query?.q || "").trim();
    const legacyVisitOnly = req.query?.venueId && !resourceTypes && !queryText;
    const result = legacyVisitOnly
      ? await visitMarketplace.listVisitCatalog({
          actorUserId: req.user._id,
          venueId: req.query.venueId,
          page: req.query?.page,
          limit: req.query?.limit,
        })
      : await marketplace.listCatalog({
          actorUserId: req.user._id,
          page: req.query?.page,
          limit: req.query?.limit,
          queryText,
          resourceTypes,
          sellerType: req.query?.sellerType || null,
          sellerId: req.query?.sellerId || null,
        });
    res.status(200).json(result);
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    res.status(200).json(await marketplace.getListingDetail({
      listingId: req.params.listingId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function createListing(req, res, next) {
  try {
    const resourceType = req.body?.resourceType || (req.body?.visitId ? "visit" : null);
    const resourceId = req.body?.resourceId || req.body?.visitId;
    res.status(201).json(await marketplace.createListing({
      resourceType,
      resourceId,
      sellerType: req.body?.sellerType,
      sellerId: req.body?.sellerId,
      actorUserId: req.user._id,
      metadata: {
        title: req.body?.title,
        summary: req.body?.summary,
        catalogMetadata: req.body?.catalogMetadata,
      },
    }));
  } catch (error) { next(error); }
}

async function createOffer(req, res, next) {
  try {
    if (Array.isArray(req.body?.grants) && req.body.grants.length) {
      res.status(201).json(await marketplace.createOffer({
        listingId: req.params.listingId,
        payload: req.body,
        actorUserId: req.user._id,
      }));
      return;
    }
    res.status(201).json(await visitMarketplace.createVisitExecuteOffer({
      listingId: req.params.listingId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function acquire(req, res, next) {
  try {
    const result = await marketplace.acquireOffer({
      offerId: req.params.offerId,
      actorUserId: req.user._id,
      beneficiaryType: req.body?.beneficiaryType || "user",
      beneficiaryId: req.body?.beneficiaryId || req.user._id,
    });
    res.status(result.alreadyAcquired ? 200 : 201).json(projectAcquisitionResult(result));
  } catch (error) { next(error); }
}

async function acquisitionHistory(req, res, next) {
  try {
    res.status(200).json(await marketplace.listAcquisitionHistory({
      actorUserId: req.user._id,
      beneficiaryType: req.query?.beneficiaryType || "user",
      beneficiaryId: req.query?.beneficiaryId || req.user._id,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function creatorWorkspace(req, res, next) {
  try {
    res.status(200).json(await workspace.getCreatorWorkspace({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
    }));
  } catch (error) { next(error); }
}

async function distributionDashboard(req, res, next) {
  try {
    res.status(200).json(await workspace.getDistributionDashboard({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

module.exports = {
  projectAcquisitionResult,
  catalog,
  detail,
  createListing,
  createOffer,
  acquire,
  acquisitionHistory,
  creatorWorkspace,
  distributionDashboard,
};
