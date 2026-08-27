const Organization = require("../models/organization.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { resolveActorPrincipals } = require("./principalResolution.service");
const { resolveCapabilityAccess, nowWithin } = require("./capabilityAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function samePrincipal(a, type, principalId) { return a?.type === type && id(a.id) === id(principalId); }

function versionBehaviour(versionPolicy) {
  if (versionPolicy === "follow_current") return { code: "follow_current", label: "Include gli aggiornamenti futuri" };
  if (versionPolicy === "pin_at_acquisition") return { code: "pinned_at_acquisition", label: "Mantiene la versione acquisita" };
  return { code: "pinned", label: "Versione fissa" };
}

async function availableBeneficiaryProjection(actorUserId) {
  const { user, principals } = await resolveActorPrincipals(actorUserId);
  const organizationIds = principals.filter((entry) => entry.type === "organization").map((entry) => entry.id);
  const organizations = organizationIds.length
    ? await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("name").lean()
    : [];
  const organizationNameById = new Map(organizations.map((entry) => [id(entry._id), entry.name]));
  return principals.filter((principal) => principal.type === "user" || [
    "marketplace.acquire",
    "marketplace.acquisitions.view",
  ].some((code) => principal.effectivePermissions.includes(code))).map((principal) => ({
    type: principal.type,
    id: principal.id,
    name: principal.type === "user" ? user.username : (organizationNameById.get(id(principal.id)) || "Organizzazione"),
    roles: principal.roles,
    isOwner: principal.isOwner,
    availableOperations: principal.type === "user" ? ["marketplace.acquire", "marketplace.acquisitions.view"] : [
      ...(principal.effectivePermissions.includes("marketplace.acquire") ? ["marketplace.acquire"] : []),
      ...(principal.effectivePermissions.includes("marketplace.acquisitions.view") ? ["marketplace.acquisitions.view"] : []),
    ],
  }));
}

async function resolveBeneficiaryContext({ actorUserId, beneficiaryType = null, beneficiaryId = null }) {
  if ((beneficiaryType && !beneficiaryId) || (!beneficiaryType && beneficiaryId)) {
    throw new AppError("beneficiaryType e beneficiaryId devono essere specificati insieme", 400, [{ code: "INVALID_BENEFICIARY_SCOPE" }]);
  }
  const availableBeneficiaries = await availableBeneficiaryProjection(actorUserId);
  const selectedBeneficiary = beneficiaryType && beneficiaryId
    ? availableBeneficiaries.find((entry) => samePrincipal(entry, beneficiaryType, beneficiaryId))
    : availableBeneficiaries.find((entry) => entry.type === "user");
  if (!selectedBeneficiary) {
    throw new AppError("Destinatario non disponibile per l'utente corrente", 403, [{ code: "PRINCIPAL_AUTHORITY_REQUIRED" }]);
  }
  return { selectedBeneficiary, availableBeneficiaries };
}

async function projectListingConsumerDetail({
  actorUserId,
  projected,
  beneficiaryType = null,
  beneficiaryId = null,
}) {
  const context = await resolveBeneficiaryContext({ actorUserId, beneficiaryType, beneficiaryId });
  const projectedOffers = projected?.offers || [];
  const offerIds = projectedOffers.map((offer) => offer.id).filter(Boolean);
  const offerDocuments = offerIds.length
    ? await MarketplaceOffer.find({ _id: { $in: offerIds }, status: "active" }).lean()
    : [];
  const offerById = new Map(offerDocuments.map((offer) => [id(offer._id), offer]));
  const availableCapabilities = new Set();

  const offers = [];
  for (const offer of projectedOffers) {
    const document = offerById.get(id(offer.id));
    const grants = document?.grants || [];
    const uses = [];
    for (let index = 0; index < (offer.uses || []).length; index += 1) {
      const use = offer.uses[index];
      const grant = grants[index];
      let available = false;
      if (grant) {
        const access = await resolveCapabilityAccess({
          actorUserId,
          capability: grant.capability,
          resourceType: grant.resourceType,
          resourceId: grant.resourceId,
          principalType: context.selectedBeneficiary.type,
          principalId: context.selectedBeneficiary.id,
        });
        available = access.allowed;
      }
      if (available) availableCapabilities.add(use.capability);
      uses.push({ ...use, available });
    }
    offers.push({
      ...offer,
      uses,
      fullyAvailable: uses.length > 0 && uses.every((use) => use.available),
    });
  }

  return {
    ...projected,
    offers,
    viewerState: {
      ...(projected.viewerState || {}),
      availableCapabilities: [...availableCapabilities],
      alreadyUsable: availableCapabilities.size > 0,
    },
    acquisitionContext: context,
  };
}

async function enrichAcquisitionHistory({ actorUserId, history }) {
  const context = await resolveBeneficiaryContext({
    actorUserId,
    beneficiaryType: history?.beneficiary?.type,
    beneficiaryId: history?.beneficiary?.id,
  });
  const results = history?.results || [];
  const acquisitionIds = results.map((entry) => entry.id).filter(Boolean);
  const listingIds = results.map((entry) => entry.listingId).filter(Boolean);
  const [entitlements, listings] = await Promise.all([
    acquisitionIds.length
      ? Entitlement.find({ sourceAcquisitionId: { $in: acquisitionIds } }).sort({ createdAt: 1 }).lean()
      : [],
    listingIds.length
      ? MarketplaceListing.find({ _id: { $in: listingIds } }).select("status").lean()
      : [],
  ]);
  const entitlementsByAcquisition = new Map();
  for (const entitlement of entitlements) {
    const key = id(entitlement.sourceAcquisitionId);
    if (!entitlementsByAcquisition.has(key)) entitlementsByAcquisition.set(key, []);
    entitlementsByAcquisition.get(key).push(entitlement);
  }
  const listingStatusById = new Map(listings.map((listing) => [id(listing._id), listing.status]));

  return {
    ...history,
    beneficiary: context.selectedBeneficiary,
    availableBeneficiaries: context.availableBeneficiaries,
    results: results.map((entry) => {
      const labelByCapability = new Map((entry.grants || []).map((grant) => [grant.capability, grant.label]));
      const currentRights = (entitlementsByAcquisition.get(id(entry.id)) || []).map((entitlement) => ({
        capability: entitlement.capability,
        label: labelByCapability.get(entitlement.capability) || entitlement.capability,
        resourceType: entitlement.resourceType,
        resourceId: entitlement.resourceId,
        versionPolicy: entitlement.versionPolicy,
        versionBehaviour: versionBehaviour(entitlement.versionPolicy),
        status: entitlement.status,
        active: nowWithin(entitlement),
      }));
      return {
        ...entry,
        listingStatus: listingStatusById.get(id(entry.listingId)) || "unavailable",
        currentRights,
      };
    }),
  };
}

module.exports = {
  availableBeneficiaryProjection,
  resolveBeneficiaryContext,
  projectListingConsumerDetail,
  enrichAcquisitionHistory,
};
