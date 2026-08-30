const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContext = require("../models/editorialContext.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { assertCapabilitySource, resolveCapabilitySource } = require("./capabilityAuthorization.service");

function sameId(a, b) { return String(a || "") === String(b || ""); }

async function assertCanComposeEditorialRelease({ editorialReleaseId, actorUserId, principalType, principalId }) {
  const release = await EditorialRelease.findById(editorialReleaseId).lean();
  if (!release) throw new AppError("EditorialRelease sorgente non disponibile", 404);
  const context = await EditorialContext.findOne({ _id: release.editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("EditorialContext sorgente non disponibile", 409);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.compose_visit",
    resourceType: "editorial_context",
    resourceId: context._id,
    principalType,
    principalId,
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

async function authorizeVisitEditorialSources({ editorialSources = [], actorUserId, principalType, principalId }) {
  const result = [];
  const seen = new Set();
  for (const source of editorialSources || []) {
    const releaseId = source?.editorialReleaseId;
    const key = String(releaseId || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(await assertCanComposeEditorialRelease({
      editorialReleaseId: releaseId,
      actorUserId,
      principalType,
      principalId,
    }));
  }
  return result;
}

async function assertCanUseItemRevisionInVisit({ itemRevisionId, itemEditionId = null, actorUserId, principalType, principalId }) {
  const revision = await ItemRevisionV2.findOne({ _id: itemRevisionId, status: { $in: ["published", "superseded"] } }).lean();
  if (!revision) throw new AppError("Contenuto non disponibile per la visita", 404, [{ field: "itemRevisionId", code: "ITEM_REVISION_NOT_AVAILABLE" }]);
  const editionId = itemEditionId || revision.itemEditionId;
  if (!sameId(revision.itemEditionId, editionId)) throw new AppError("La versione non appartiene al contenuto selezionato", 409, [{ field: "itemRevisionId", code: "ITEM_REVISION_MISMATCH" }]);
  const edition = await ItemEdition.findById(editionId).lean();
  const item = edition ? await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" }).select("_id primarySubjectId ownerType ownerId").lean() : null;
  if (!edition || !item) throw new AppError("Contenuto non più disponibile", 409, [{ field: "itemEditionId", code: "ITEM_NOT_ACTIVE" }]);

  const requests = [
    { resourceType: "item_edition", resourceId: edition._id },
    { resourceType: "item_revision", resourceId: revision._id },
  ];
  for (const request of requests) {
    const access = await resolveCapabilitySource({
      actorUserId,
      capability: "content.use_in_visit",
      ...request,
      principalType,
      principalId,
    });
    if (!access.allowed) continue;
    const snapshot = access.resolvedSnapshotRef;
    if (snapshot && (snapshot.resourceType !== "item_revision" || !sameId(snapshot.resourceId, revision._id))) continue;
    return { access, revision, edition, item };
  }
  throw new AppError("Non hai il diritto di usare questo contenuto in una visita", 403, [{
    field: "itemRevisionId",
    code: "CONTENT_USE_IN_VISIT_REQUIRED",
    context: { itemEditionId: edition._id, itemRevisionId: revision._id },
  }]);
}

async function authorizeVisitContentSources({ contentSources = [], actorUserId, principalType, principalId }) {
  const result = [];
  const seen = new Set();
  for (const source of contentSources || []) {
    const sourceType = source?.sourceType;
    const sourceId = sourceType === "editorial_release" ? source?.editorialReleaseId : source?.itemRevisionId;
    const key = `${sourceType}:${String(sourceId || "")}`;
    if (!sourceType || !sourceId || seen.has(key)) continue;
    seen.add(key);
    if (sourceType === "editorial_release") {
      result.push({ source, sourceType, ...(await assertCanComposeEditorialRelease({ editorialReleaseId: sourceId, actorUserId, principalType, principalId })) });
    } else if (sourceType === "item_revision") {
      result.push({ source, sourceType, ...(await assertCanUseItemRevisionInVisit({ itemRevisionId: sourceId, actorUserId, principalType, principalId })) });
    }
  }
  return result;
}

module.exports = {
  assertCanComposeEditorialRelease,
  assertCanUseItemRevisionInVisit,
  authorizeVisitEditorialSources,
  authorizeVisitContentSources,
};
