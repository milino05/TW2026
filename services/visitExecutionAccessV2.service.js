const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const {
  resolveCapabilityAccess,
  listValidCapabilityEntitlements,
  nowWithin,
} = require("./capabilityAuthorization.service");
const { resolveActorPrincipals } = require("./principalResolution.service");

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function entitlementPredates(entitlement, instant) {
  if (!instant) return true;
  const at = new Date(instant);
  const createdInTime = !entitlement.createdAt || new Date(entitlement.createdAt) <= at;
  const validFromInTime = !entitlement.validFrom || new Date(entitlement.validFrom) <= at;
  return createdInTime && validFromInTime;
}

async function listPinnedVisitRevisionEntitlements({ visitId, userId, preparedAt = null }) {
  const revisions = await VisitRevisionV2.find({
    visitId,
    status: { $in: ["published", "superseded"] },
  }).select("_id").lean();
  if (!revisions.length) return [];
  const { principals } = await resolveActorPrincipals(userId);
  const principalClauses = principals.map((principal) => ({
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
  }));
  if (!principalClauses.length) return [];
  const candidates = await Entitlement.find({
    $or: principalClauses,
    resourceType: "visit_revision",
    resourceId: { $in: revisions.map((revision) => revision._id) },
    capability: "visit.execute",
    versionPolicy: "pinned",
    status: "active",
  }).sort({ createdAt: -1 }).lean();
  return candidates.filter((entry) => nowWithin(entry) && entitlementPredates(entry, preparedAt));
}

async function resolveLiveVisitAccess({ visit, userId }) {
  return resolveCapabilityAccess({
    actorUserId: userId,
    capability: "visit.execute",
    resourceType: "visit",
    resourceId: visit._id,
  });
}

async function resolveExecutableVisitRevisionV2({ visit, userId }) {
  if (!visit) throw new AppError("Visita non trovata", 404);
  const liveAccess = await resolveLiveVisitAccess({ visit, userId });
  let access = liveAccess;
  let revisionId = null;

  if (liveAccess.allowed) {
    revisionId = visit.publishedRevisionId;
    if (liveAccess.entitlement?.versionPolicy === "pinned") {
      const snapshot = liveAccess.entitlement.baselineSnapshotRef;
      if (snapshot?.resourceType !== "visit_revision") {
        throw new AppError("Entitlement pinned senza VisitRevision risolvibile", 409, [{ code: "PINNED_VISIT_REVISION_REQUIRED" }]);
      }
      revisionId = snapshot.resourceId;
    }
  } else {
    const pinned = await listPinnedVisitRevisionEntitlements({ visitId: visit._id, userId });
    const entitlement = pinned[0] || null;
    if (!entitlement) {
      throw new AppError("Capability richiesta non disponibile", 403, [{
        code: "CAPABILITY_REQUIRED",
        capability: "visit.execute",
        resourceType: "visit",
        resourceId: visit._id,
      }]);
    }
    revisionId = entitlement.resourceId;
    access = {
      allowed: true,
      basis: "entitlement",
      principal: { type: entitlement.beneficiaryType, id: entitlement.beneficiaryId },
      entitlement,
    };
  }

  if (!revisionId) throw new AppError("Visit senza revisione eseguibile", 409, [{ code: "EXECUTABLE_VISIT_REVISION_REQUIRED" }]);
  const revision = await VisitRevisionV2.findOne({
    _id: revisionId,
    visitId: visit._id,
    status: { $in: ["published", "superseded"] },
  }).lean();
  if (!revision) throw new AppError("VisitRevision eseguibile non disponibile", 409, [{ code: "VISIT_REVISION_NOT_AVAILABLE" }]);
  return { access, revision };
}

async function assertCanExecuteVisitV2(visit, userId) {
  return (await resolveExecutableVisitRevisionV2({ visit, userId })).access;
}

async function assertCanExecuteResolvedVisitRevisionV2({ visit, userId, visitRevisionId, preparedAt }) {
  if (!visit) throw new AppError("Visita non trovata", 404);
  const currentAccess = await resolveLiveVisitAccess({ visit, userId });
  if (currentAccess.basis === "ownership" || currentAccess.basis === "principal_authority") return currentAccess;

  if (currentAccess.allowed && currentAccess.entitlement) {
    const entitlement = currentAccess.entitlement;
    if (entitlement.versionPolicy === "follow_current" && entitlementPredates(entitlement, preparedAt)) return currentAccess;
    if (entitlement.versionPolicy === "pinned") {
      const snapshot = entitlement.baselineSnapshotRef;
      if (snapshot?.resourceType === "visit_revision" && sameId(snapshot.resourceId, visitRevisionId) && entitlementPredates(entitlement, preparedAt)) {
        return currentAccess;
      }
    }
  }

  const { entitlements: liveEntitlements } = await listValidCapabilityEntitlements({
    actorUserId: userId,
    capability: "visit.execute",
    resourceType: "visit",
    resourceId: visit._id,
  });
  const matchingLive = liveEntitlements.find((entitlement) => {
    if (!entitlementPredates(entitlement, preparedAt)) return false;
    if (entitlement.versionPolicy === "follow_current") return true;
    return entitlement.versionPolicy === "pinned"
      && entitlement.baselineSnapshotRef?.resourceType === "visit_revision"
      && sameId(entitlement.baselineSnapshotRef.resourceId, visitRevisionId);
  });
  if (matchingLive) {
    return {
      allowed: true,
      basis: "entitlement",
      principal: { type: matchingLive.beneficiaryType, id: matchingLive.beneficiaryId },
      entitlement: matchingLive,
    };
  }

  const pinned = await listPinnedVisitRevisionEntitlements({ visitId: visit._id, userId, preparedAt });
  const matchingPinned = pinned.find((entitlement) => sameId(entitlement.resourceId, visitRevisionId));
  if (matchingPinned) {
    return {
      allowed: true,
      basis: "entitlement",
      principal: { type: matchingPinned.beneficiaryType, id: matchingPinned.beneficiaryId },
      entitlement: matchingPinned,
    };
  }

  throw new AppError("Il diritto corrente non autorizza piu la VisitRevision preparata", 403, [{
    code: "PREPARATION_SOURCE_AUTHORIZATION_CHANGED",
    context: { visitRevisionId },
  }]);
}

module.exports = {
  assertCanExecuteVisitV2,
  resolveExecutableVisitRevisionV2,
  assertCanExecuteResolvedVisitRevisionV2,
  listPinnedVisitRevisionEntitlements,
};
