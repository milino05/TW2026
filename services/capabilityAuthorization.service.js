const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { capabilitySupportsResource } = require("../config/marketplaceCapabilities");
const { resolveActorPrincipals } = require("./principalResolution.service");

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function nowWithin(entitlement, now = new Date()) {
  const startOk = !entitlement.validFrom || new Date(entitlement.validFrom) <= now;
  const endOk = !entitlement.validUntil || new Date(entitlement.validUntil) > now;
  return entitlement.status === "active" && startOk && endOk;
}

async function resolveOwnedResource(resourceType, resourceId) {
  if (resourceType === "visit") {
    const visit = await VisitV2.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
    return visit ? { ownerType: visit.ownerType, ownerId: visit.ownerId, resource: visit } : null;
  }
  if (resourceType === "visit_revision") {
    const revision = await VisitRevisionV2.findById(resourceId).lean();
    if (!revision) return null;
    const visit = await VisitV2.findOne({ _id: revision.visitId, lifecycleStatus: "active" }).lean();
    return visit ? { ownerType: visit.ownerType, ownerId: visit.ownerId, resource: revision, aggregate: visit } : null;
  }
  return null;
}

async function resolveCapabilityAccess({ actorUserId, capability, resourceType, resourceId, now = new Date() }) {
  if (!capabilitySupportsResource(capability, resourceType)) {
    throw new AppError("Capability non compatibile con la risorsa", 400, [{
      code: "INVALID_CAPABILITY_RESOURCE",
      capability,
      resourceType,
    }]);
  }

  const { principals } = await resolveActorPrincipals(actorUserId);
  const owned = await resolveOwnedResource(resourceType, resourceId);
  const ownerPrincipal = owned
    ? principals.find((principal) => principal.type === owned.ownerType && sameId(principal.id, owned.ownerId))
    : null;
  if (ownerPrincipal) {
    return {
      allowed: true,
      basis: owned.ownerType === "user" ? "ownership" : "principal_authority",
      principal: { type: owned.ownerType, id: owned.ownerId },
      entitlement: null,
    };
  }

  const principalClauses = principals.map((principal) => ({
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
  }));
  const entitlements = principalClauses.length
    ? await Entitlement.find({
      $or: principalClauses,
      resourceType,
      resourceId,
      capability,
      status: "active",
    }).sort({ createdAt: 1 }).lean()
    : [];
  const entitlement = entitlements.find((entry) => nowWithin(entry, now));
  if (entitlement) {
    return {
      allowed: true,
      basis: "entitlement",
      principal: { type: entitlement.beneficiaryType, id: entitlement.beneficiaryId },
      entitlement,
    };
  }

  return { allowed: false, basis: null, principal: null, entitlement: null };
}

async function assertCapability(args) {
  const result = await resolveCapabilityAccess(args);
  if (!result.allowed) {
    throw new AppError("Capability richiesta non disponibile", 403, [{
      code: "CAPABILITY_REQUIRED",
      capability: args.capability,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }]);
  }
  return result;
}

module.exports = {
  nowWithin,
  resolveCapabilityAccess,
  assertCapability,
};
