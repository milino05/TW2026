const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const {
  assertCapability,
  resolveCapabilityAccess,
  listValidCapabilityEntitlements,
} = require("./capabilityAuthorization.service");

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

async function assertCanExecuteVisitV2(visit, userId) {
  if (!visit) throw new AppError("Visita non trovata", 404);
  return assertCapability({
    actorUserId: userId,
    capability: "visit.execute",
    resourceType: "visit",
    resourceId: visit._id,
  });
}

async function resolveExecutableVisitRevisionV2({ visit, userId }) {
  const access = await assertCanExecuteVisitV2(visit, userId);
  let revisionId = visit.publishedRevisionId;
  if (access.entitlement?.versionPolicy === "pinned") {
    const snapshot = access.entitlement.baselineSnapshotRef;
    if (snapshot?.resourceType !== "visit_revision") {
      throw new AppError("Entitlement pinned senza VisitRevision risolvibile", 409, [{ code: "PINNED_VISIT_REVISION_REQUIRED" }]);
    }
    revisionId = snapshot.resourceId;
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

async function assertCanExecuteResolvedVisitRevisionV2({ visit, userId, visitRevisionId, preparedAt }) {
  if (!visit) throw new AppError("Visita non trovata", 404);
  const currentAccess = await resolveCapabilityAccess({
    actorUserId: userId,
    capability: "visit.execute",
    resourceType: "visit",
    resourceId: visit._id,
  });
  if (!currentAccess.allowed) {
    throw new AppError("Accesso all'esecuzione della Visit non piu disponibile", 403, [{
      code: "PREPARATION_SOURCE_AUTHORIZATION_CHANGED",
    }]);
  }
  if (currentAccess.basis === "ownership" || currentAccess.basis === "principal_authority") return currentAccess;

  const { entitlements } = await listValidCapabilityEntitlements({
    actorUserId: userId,
    capability: "visit.execute",
    resourceType: "visit",
    resourceId: visit._id,
  });
  const preparationTime = preparedAt ? new Date(preparedAt) : new Date();
  const matching = entitlements.find((entitlement) => {
    if (entitlement.versionPolicy === "pinned") {
      return entitlement.baselineSnapshotRef?.resourceType === "visit_revision"
        && sameId(entitlement.baselineSnapshotRef.resourceId, visitRevisionId);
    }
    if (entitlement.versionPolicy === "follow_current") {
      const createdInTime = !entitlement.createdAt || new Date(entitlement.createdAt) <= preparationTime;
      const validFromInTime = !entitlement.validFrom || new Date(entitlement.validFrom) <= preparationTime;
      return createdInTime && validFromInTime;
    }
    return false;
  });
  if (!matching) {
    throw new AppError("Il diritto corrente non autorizza piu la VisitRevision preparata", 403, [{
      code: "PREPARATION_SOURCE_AUTHORIZATION_CHANGED",
      context: { visitRevisionId },
    }]);
  }
  return {
    allowed: true,
    basis: "entitlement",
    principal: { type: matching.beneficiaryType, id: matching.beneficiaryId },
    entitlement: matching,
  };
}

module.exports = {
  assertCanExecuteVisitV2,
  resolveExecutableVisitRevisionV2,
  assertCanExecuteResolvedVisitRevisionV2,
};
