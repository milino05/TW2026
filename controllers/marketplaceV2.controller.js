const marketplace = require("../services/marketplaceV2.service");
const marketplaceCatalog = require("../services/marketplaceCatalogV2.service");
const visitMarketplace = require("../services/marketplaceVisitV2.service");
const workspace = require("../services/marketplaceWorkspaceV2.service");
const workspaceResources = require("../services/marketplaceWorkspaceResourcesV2.service");
const commercial = require("../services/marketplaceCommercialV2.service");
const accountWorkspace = require("../services/marketplaceAccountWorkspaceV2.service");
const management = require("../services/marketplaceManagementV2.service");
const itemAuthoring = require("../services/itemAuthoringV2.service");
const { getNamespaceAuthoringControls } = require("../services/namespaceAuthoringV2.service");
const { executeWorkspaceOperation } = require("../services/marketplaceWorkspaceOperationsV2.service");

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

function selectedVenueIds(req) {
  return marketplaceCatalog.normalizeVenueIds(req.query?.selectedVenueIds || []);
}

async function catalog(req, res, next) {
  try {
    res.status(200).json(await marketplaceCatalog.listCatalog({
      actorUserId: req.user._id,
      page: req.query?.page,
      limit: req.query?.limit,
      queryText: String(req.query?.q || "").trim(),
      resourceTypes: req.query?.resourceTypes || req.query?.resourceType || null,
      sellerType: req.query?.sellerType || null,
      sellerId: req.query?.sellerId || null,
      selectedVenueIds: selectedVenueIds(req),
    }));
  } catch (error) { next(error); }
}

async function venueSelector(req, res, next) {
  try {
    res.status(200).json(await marketplaceCatalog.resolveVenueSelectorProjection());
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    res.status(200).json(await marketplaceCatalog.getListingDetail({
      listingId: req.params.listingId,
      actorUserId: req.user._id,
      selectedVenueIds: selectedVenueIds(req),
    }));
  } catch (error) { next(error); }
}

async function itemAuthoringProjection(req, res, next) {
  try {
    res.status(200).json(await itemAuthoring.getItemAuthoringProjection({
      itemId: req.params.itemId,
      editionId: req.query?.editionId || null,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function namespaceAuthoringControls(req, res, next) {
  try {
    res.status(200).json(await getNamespaceAuthoringControls({
      namespaceId: req.params.namespaceId,
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
    }));
  } catch (error) { next(error); }
}

async function venueTargetAuthoringContext(req, res, next) {
  try {
    res.status(200).json(await itemAuthoring.getVenueTargetAuthoringContext({
      venueTargetId: req.params.venueTargetId,
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

async function commercialManagement(req, res, next) {
  try {
    res.status(200).json(await commercial.getCommercialManagement({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function withdrawListing(req, res, next) {
  try {
    res.status(200).json(await marketplace.withdrawListing({
      listingId: req.params.listingId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function withdrawOffer(req, res, next) {
  try {
    res.status(200).json(await marketplace.withdrawOffer({
      offerId: req.params.offerId,
      actorUserId: req.user._id,
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

async function creatorWorkspaceContext(req, res, next) {
  try {
    res.status(200).json(await workspaceResources.getCreatorWorkspaceContext({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
    }));
  } catch (error) { next(error); }
}

async function creatorWorkspaceResources(req, res, next) {
  try {
    res.status(200).json(await workspaceResources.listCreatorWorkspaceResources({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
      ownership: req.query?.ownership || "owned",
      q: req.query?.q || "",
      resourceTypes: req.query?.resourceTypes || req.query?.resourceType || null,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function marketplaceAccountWorkspace(req, res, next) {
  try {
    res.status(200).json(await accountWorkspace.getMarketplaceAccountWorkspace({
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function marketplaceOrganizationDetail(req, res, next) {
  try {
    res.status(200).json(await accountWorkspace.getMarketplaceOrganizationDetail({
      actorUserId: req.user._id,
      organizationId: req.params.organizationId,
      memberPage: req.query?.memberPage,
      venuePage: req.query?.venuePage,
      namespacePage: req.query?.namespacePage,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function marketplaceNamespaceManagement(req, res, next) {
  try {
    res.status(200).json(await management.getNamespaceManagementProjection({
      namespaceId: req.params.namespaceId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function marketplaceVenueManagement(req, res, next) {
  try {
    res.status(200).json(await management.getVenueManagementProjection({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
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

async function workspaceOperation(req, res, next) {
  try {
    res.status(201).json(await executeWorkspaceOperation({
      operationCode: req.body?.operationCode,
      sourceRef: req.body?.sourceRef,
      targetPrincipal: req.body?.targetPrincipal || { type: "user", id: req.user._id },
      payload: req.body?.payload || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = {
  projectAcquisitionResult,
  catalog,
  venueSelector,
  detail,
  itemAuthoringProjection,
  namespaceAuthoringControls,
  venueTargetAuthoringContext,
  createListing,
  createOffer,
  acquire,
  acquisitionHistory,
  commercialManagement,
  withdrawListing,
  withdrawOffer,
  creatorWorkspace,
  creatorWorkspaceContext,
  creatorWorkspaceResources,
  marketplaceAccountWorkspace,
  marketplaceOrganizationDetail,
  marketplaceNamespaceManagement,
  marketplaceVenueManagement,
  distributionDashboard,
  workspaceOperation,
};
