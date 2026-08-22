const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const { assertCapability } = require("./capabilityAuthorization.service");

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

module.exports = {
  assertCanExecuteVisitV2,
  resolveExecutableVisitRevisionV2,
};
