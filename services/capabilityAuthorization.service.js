const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { capabilitySupportsResource } = require("../config/marketplaceCapabilities");
const { resolveActorPrincipals } = require("./principalResolution.service");
const {
  LIVE_RESOURCE_TYPES,
  resolveResourceAuthority,
  resolveCurrentSnapshotRef,
  listPublishedSnapshotRefsForLive,
} = require("./marketplaceResourceV2.service");

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

function assertSupported(capability, resourceType) {
  if (!capabilitySupportsResource(capability, resourceType)) {
    throw new AppError("Capability non compatibile con la risorsa", 400, [{
      code: "INVALID_CAPABILITY_RESOURCE",
      capability,
      resourceType,
    }]);
  }
}

async function listValidCapabilityEntitlements({ actorUserId, capability, resourceType, resourceId, now = new Date() }) {
  assertSupported(capability, resourceType);
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
  assertSupported(capability, resourceType);

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

async function resolveCapabilitySource({ actorUserId, capability, resourceType, resourceId, now = new Date() }) {
  assertSupported(capability, resourceType);
  const requestedResourceRef = { resourceType, resourceId };
  const exact = await resolveCapabilityAccess({ actorUserId, capability, resourceType, resourceId, now });
  const authority = await resolveResourceAuthority(resourceType, resourceId);

  if (exact.allowed) {
    let resolvedSnapshotRef = null;
    if (LIVE_RESOURCE_TYPES.has(resourceType)) {
      if (exact.entitlement?.versionPolicy === "pinned" && exact.entitlement.baselineSnapshotRef) {
        resolvedSnapshotRef = exact.entitlement.baselineSnapshotRef;
      } else {
        resolvedSnapshotRef = await resolveCurrentSnapshotRef(resourceType, authority);
      }
    } else if (authority) {
      resolvedSnapshotRef = { resourceType, resourceId: authority.resource._id };
    }
    if (!resolvedSnapshotRef) {
      throw new AppError("Snapshot autorizzata non disponibile", 409, [{ code: "AUTHORIZED_SNAPSHOT_UNAVAILABLE" }]);
    }
    return { ...exact, requestedResourceRef, resolvedSnapshotRef };
  }

  if (!LIVE_RESOURCE_TYPES.has(resourceType)) {
    return { ...exact, requestedResourceRef, resolvedSnapshotRef: null };
  }

  const snapshots = await listPublishedSnapshotRefsForLive(resourceType, resourceId);
  if (!snapshots.length) return { ...exact, requestedResourceRef, resolvedSnapshotRef: null };
  const snapshotType = snapshots[0].resourceType;
  if (!capabilitySupportsResource(capability, snapshotType)) {
    return { ...exact, requestedResourceRef, resolvedSnapshotRef: null };
  }

  const { principals } = await resolveActorPrincipals(actorUserId);
  const principalClauses = principals.map((principal) => ({
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
  }));
  if (!principalClauses.length) return { ...exact, requestedResourceRef, resolvedSnapshotRef: null };
  const candidates = await Entitlement.find({
    $or: principalClauses,
    resourceType: snapshotType,
    resourceId: { $in: snapshots.map((snapshot) => snapshot.resourceId) },
    capability,
    versionPolicy: "pinned",
    status: "active",
  }).lean();
  const validByResourceId = new Map(
    candidates.filter((entry) => nowWithin(entry, now)).map((entry) => [String(entry.resourceId), entry]),
  );
  const selectedSnapshot = snapshots.find((snapshot) => validByResourceId.has(String(snapshot.resourceId)));
  if (!selectedSnapshot) return { ...exact, requestedResourceRef, resolvedSnapshotRef: null };
  const entitlement = validByResourceId.get(String(selectedSnapshot.resourceId));
  return {
    allowed: true,
    basis: "entitlement",
    principal: { type: entitlement.beneficiaryType, id: entitlement.beneficiaryId },
    entitlement,
    requestedResourceRef,
    resolvedSnapshotRef: selectedSnapshot,
  };
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

async function assertCapabilitySource(args) {
  const result = await resolveCapabilitySource(args);
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
  resolveCapabilitySource,
  assertCapability,
  assertCapabilitySource,
};
