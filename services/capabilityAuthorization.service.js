const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { capabilitySupportsResource } = require("../config/marketplaceCapabilities");
const { resolveActorPrincipals } = require("./principalResolution.service");
const { resolveResourceAuthority } = require("./marketplaceResourceV2.service");

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function nowWithin(entitlement, now = new Date()) {
  const startOk = !entitlement.validFrom || new Date(entitlement.validFrom) <= now;
  const endOk = !entitlement.validUntil || new Date(entitlement.validUntil) > now;
  return entitlement.status === "active" && startOk && endOk;
}

function chooseEffectiveEntitlement(entitlements, now = new Date()) {
  const valid = (entitlements || []).filter((entry) => nowWithin(entry, now));
  const followCurrent = valid.find((entry) => entry.versionPolicy === "follow_current");
  if (followCurrent) return followCurrent;
  return valid.find((entry) => entry.versionPolicy === "pinned") || null;
}

async function listValidCapabilityEntitlements({ actorUserId, capability, resourceType, resourceId, now = new Date() }) {
  if (!capabilitySupportsResource(capability, resourceType)) {
    throw new AppError("Capability non compatibile con la risorsa", 400, [{
      code: "INVALID_CAPABILITY_RESOURCE",
      capability,
      resourceType,
    }]);
  }
  const { principals } = await resolveActorPrincipals(actorUserId);
  const principalClauses = principals.map((principal) => ({
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
  }));
  if (!principalClauses.length) return { principals, entitlements: [] };
  const candidates = await Entitlement.find({
    $or: principalClauses,
    resourceType,
    resourceId,
    capability,
    status: "active",
  }).sort({ createdAt: -1 }).lean();
  return {
    principals,
    entitlements: candidates.filter((entry) => nowWithin(entry, now)),
  };
}

async function resolveCapabilityAccess({ actorUserId, capability, resourceType, resourceId, now = new Date() }) {
  if (!capabilitySupportsResource(capability, resourceType)) {
    throw new AppError("Capability non compatibile con la risorsa", 400, [{
      code: "INVALID_CAPABILITY_RESOURCE",
      capability,
      resourceType,
    }]);
  }

  const { principals, entitlements } = await listValidCapabilityEntitlements({
    actorUserId,
    capability,
    resourceType,
    resourceId,
    now,
  });
  const owned = await resolveResourceAuthority(resourceType, resourceId);
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

  const entitlement = chooseEffectiveEntitlement(entitlements, now);
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
  chooseEffectiveEntitlement,
  listValidCapabilityEntitlements,
  resolveCapabilityAccess,
  assertCapability,
};
