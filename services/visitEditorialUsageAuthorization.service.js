const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");

function sameId(a, b) { return String(a || "") === String(b || ""); }

async function assertCanComposeEditorialRelease({ editorialReleaseId, actorUserId }) {
  const release = await EditorialRelease.findById(editorialReleaseId).lean();
  if (!release) throw new AppError("EditorialRelease sorgente non disponibile", 404);
  const context = await EditorialContext.findOne({ _id: release.editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("EditorialContext sorgente non disponibile", 409);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.compose_visit",
    resourceType: "editorial_context",
    resourceId: context._id,
  });
  if (access.basis === "entitlement") {
    const ref = access.resolvedSnapshotRef;
    if (ref?.resourceType !== "editorial_release" || !sameId(ref.resourceId, release._id)) {
      throw new AppError("La EditorialRelease selezionata non e autorizzata", 403, [{
        code: "EDITORIAL_RELEASE_NOT_AUTHORIZED",
        context: { editorialReleaseId: release._id, authorizedReleaseId: ref?.resourceId || null },
      }]);
    }
  }
  return { release, context, access };
}

async function authorizeVisitEditorialSources({ editorialSources = [], actorUserId }) {
  const result = [];
  const seen = new Set();
  for (const source of editorialSources || []) {
    const releaseId = source?.editorialReleaseId;
    const key = String(releaseId || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(await assertCanComposeEditorialRelease({ editorialReleaseId: releaseId, actorUserId }));
  }
  return result;
}

module.exports = {
  assertCanComposeEditorialRelease,
  authorizeVisitEditorialSources,
};
