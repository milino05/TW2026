const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const {
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  publishWithoutReview,
  approveReviewAndPublish,
} = require("./revisionWorkflow.service");
const { clonePresentationForFork, validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const {
  normalizeRevisionPayload,
  validateCreateEditionPayload,
  validateRevisionPayloadShape,
} = require("./validation/itemV2.validation");

function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }
function sameId(a, b) { return String(a || "") === String(b || ""); }
function revisionPayload(revision) {
  const source = revision?.toObject ? revision.toObject() : revision || {};
  const fields = [
    "label", "relatedSubjectIds", "tags", "authorCredits", "metadata", "illustrativeMedia",
    "selectionSignals", "presentationVariants", "defaultPresentation", "provenance",
  ];
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

async function findItemOrFail(itemId, { includeTrashed = false } = {}) {
  const query = { _id: itemId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const item = await ItemV2.findOne(query);
  if (!item) throw new AppError("Item non trovato", 404);
  return item;
}

async function assertCanManageItem(item, actorUserId, permissionCode = "item.edit") {
  return assertCanActForOwner({
    actorUserId,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    permissionCode,
  });
}

async function listItems({ ownerType, ownerId, primarySubjectId, includeTrashed = false } = {}) {
  const query = {};
  if (ownerType) query.ownerType = ownerType;
  if (ownerId) query.ownerId = ownerId;
  if (primarySubjectId) query.primarySubjectId = primarySubjectId;
  if (!includeTrashed) query.lifecycleStatus = "active";
  return ItemV2.find(query).sort({ updatedAt: -1 });
}

async function getItem({ itemId }) {
  const item = await findItemOrFail(itemId);
  const editions = await ItemEdition.find({ itemId: item._id }).sort({ createdAt: 1 });
  return { item, editions };
}

async function resolveNamespaceRevision(namespace, requestedRevisionId = null) {
  const revisionId = requestedRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!revisionId) throw new AppError("Il Namespace non ha una revisione disponibile", 409);
  const revision = await NamespaceRevision.findOne({ _id: revisionId, namespaceId: namespace._id });
  if (!revision) throw new AppError("NamespaceRevision non trovata", 404);
  return revision;
}

async function resolveNamespaceRevisionForAuthoring({ namespace, requestedRevisionId = null, access }) {
  if (access?.basis !== "entitlement") return resolveNamespaceRevision(namespace, requestedRevisionId);
  const ref = access.resolvedSnapshotRef;
  if (ref?.resourceType !== "namespace_revision") {
    throw new AppError("Entitlement Namespace senza snapshot di authoring", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_REQUIRED" }]);
  }
  if (requestedRevisionId && !sameId(requestedRevisionId, ref.resourceId)) {
    throw new AppError("La NamespaceRevision richiesta non e autorizzata", 403, [{
      code: "NAMESPACE_REVISION_NOT_AUTHORIZED",
      context: { requestedRevisionId, authorizedRevisionId: ref.resourceId },
    }]);
  }
  const revision = await NamespaceRevision.findOne({
    _id: ref.resourceId,
    namespaceId: namespace._id,
    status: { $in: ["published", "superseded"] },
  });
  if (!revision) throw new AppError("NamespaceRevision autorizzata non disponibile", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_UNAVAILABLE" }]);
  return revision;
}

function assertPinnedNamespaceRevisionCompatible(access, authoredAgainstNamespaceRevisionId) {
  if (access?.basis !== "entitlement" || access.entitlement?.versionPolicy !== "pinned") return;
  const ref = access.resolvedSnapshotRef;
  if (ref?.resourceType !== "namespace_revision" || !sameId(ref.resourceId, authoredAgainstNamespaceRevisionId)) {
    throw new AppError("La Edition usa una NamespaceRevision diversa da quella autorizzata", 403, [{
      code: "NAMESPACE_REVISION_NOT_AUTHORIZED",
      context: { authoredAgainstNamespaceRevisionId, authorizedRevisionId: ref?.resourceId || null },
    }]);
  }
}

async function nextVersion(itemEditionId) {
  const latest = await ItemRevisionV2.findOne({ itemEditionId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function cleanupEditionGraph(edition) {
  if (!edition?._id) return;
  await ItemRevisionV2.deleteMany({ itemEditionId: edition._id }).catch(() => {});
  await edition.deleteOne().catch(() => {});
}

async function createEdition({ itemId, payload, actorUserId }) {
  const issues = validateCreateEditionPayload(payload || {});
  if (issues.length) throw new AppError("Payload non valido", 400, issues);
  const item = await findItemOrFail(itemId);
  await assertCanManageItem(item, actorUserId);
  const namespace = await Namespace.findById(payload.namespaceId);
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: item.ownerType,
    principalId: item.ownerId,
  });
  if (namespace.lifecycleStatus !== "active" && namespaceAccess.basis !== "entitlement") {
    throw new AppError("Namespace non trovato", 404);
  }
  const namespaceRevision = await resolveNamespaceRevisionForAuthoring({
    namespace,
    requestedRevisionId: payload.authoredAgainstNamespaceRevisionId,
    access: namespaceAccess,
  });
  const shapeIssues = validateRevisionPayloadShape(payload.revision || {}, { partial: false });
  if (shapeIssues.length) throw new AppError("Payload revisione non valido", 400, shapeIssues);
  let edition;
  try {
    edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: actorUserId });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      ...normalizeRevisionPayload(payload.revision),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    edition.workingRevisionId = revision._id;
    await edition.save();
    await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: namespaceRevision._id },
      resultResourceRef: { resourceType: "item_edition", resourceId: edition._id },
    });
    return { item, edition, revision };
  } catch (error) {
    await cleanupEditionGraph(edition);
    if (error?.code === 11000) throw new AppError("Esiste gia una ItemEdition per questo Item e Namespace", 409);
    throw error;
  }
}

async function getEditionContext(editionId) {
  const edition = await ItemEdition.findById(editionId);
  if (!edition) throw new AppError("ItemEdition non trovata", 404);
  const item = await findItemOrFail(edition.itemId);
  const namespace = await Namespace.findOne({ _id: edition.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace non disponibile", 409);
  return { edition, item, namespace };
}

async function createWorkingFromPublished({ edition, actorUserId }) {
  if (!edition.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await ItemRevisionV2.findById(edition.publishedRevisionId);
  if (!published) throw new AppError("Revisione pubblicata non trovata", 409);
  const presentation = clonePresentationForFork(published);
  const payload = revisionPayload(published);
  const revision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: await nextVersion(edition._id),
    basedOnRevisionId: published._id,
    authoredAgainstNamespaceRevisionId: published.authoredAgainstNamespaceRevisionId,
    ...payload,
    ...presentation,
    status: "draft",
    integrity: { status: "needs_review", issues: [] },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  edition.workingRevisionId = revision._id;
  await edition.save();
  return revision;
}

async function getWorkingRevision(edition, actorUserId) {
  if (edition.workingRevisionId) {
    const revision = await ItemRevisionV2.findById(edition.workingRevisionId);
    if (!revision) throw new AppError("Revisione di lavoro non trovata", 409);
    return revision;
  }
  return createWorkingFromPublished({ edition, actorUserId });
}

async function getExistingWorkingRevision(edition) {
  if (!edition.workingRevisionId) throw new AppError("La ItemEdition non ha una revisione di lavoro", 409);
  const revision = await ItemRevisionV2.findById(edition.workingRevisionId);
  if (!revision) throw new AppError("Revisione di lavoro non trovata", 409);
  return revision;
}

async function updateEdition({ editionId, payload, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: item.ownerType,
    principalId: item.ownerId,
  });
  const issues = validateRevisionPayloadShape(payload || {}, { partial: true });
  if (issues.length) throw new AppError("Payload revisione non valido", 400, issues);
  const revision = await getWorkingRevision(edition, actorUserId);
  assertPinnedNamespaceRevisionCompatible(namespaceAccess, revision.authoredAgainstNamespaceRevisionId);
  try { markRevisionEdited(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  const normalized = normalizeRevisionPayload(payload || {});
  for (const [key, value] of Object.entries(normalized)) if (hasOwn(payload, key)) revision[key] = value;
  revision.updatedBy = actorUserId;
  await revision.save();
  return { item, edition, revision };
}

async function checkEditionConsistency({ editionId, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: item.ownerType,
    principalId: item.ownerId,
  });
  const revision = await getWorkingRevision(edition, actorUserId);
  assertPinnedNamespaceRevisionCompatible(namespaceAccess, revision.authoredAgainstNamespaceRevisionId);
  const namespaceRevision = await NamespaceRevision.findOne({
    _id: revision.authoredAgainstNamespaceRevisionId,
    namespaceId: edition.namespaceId,
  });
  if (!namespaceRevision) throw new AppError("NamespaceRevision di authoring non valida", 409);
  const issues = validatePresentationAgainstNamespace(revision, namespaceRevision);
  revision.integrity = {
    status: issues.length ? "needs_review" : "valid",
    issues,
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  await revision.save();
  return { revision, issues };
}

async function finalizePrivateEdition({ editionId, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId, "item.edit");
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: item.ownerType,
    principalId: item.ownerId,
  });
  const revision = await getExistingWorkingRevision(edition);
  assertPinnedNamespaceRevisionCompatible(namespaceAccess, revision.authoredAgainstNamespaceRevisionId);
  if (revision.integrity?.status !== "valid") {
    throw new AppError("Il contenuto deve superare il controllo prima di diventare privato", 409);
  }
  try {
    publishWithoutReview(revision, actorUserId);
  } catch (error) {
    throw new AppError(error.message, 409, [{ code: error.code }]);
  }
  const previousId = edition.publishedRevisionId;
  await revision.save();
  if (previousId && String(previousId) !== String(revision._id)) {
    await ItemRevisionV2.updateOne({ _id: previousId, status: "published" }, { $set: { status: "superseded" } });
  }
  edition.publishedRevisionId = revision._id;
  edition.workingRevisionId = null;
  await edition.save();
  return { item, edition, revision, finalized: true, visibility: "private" };
}

async function requestEditionReview({ editionId, actorUserId }) {
  const { edition, item } = await getEditionContext(editionId);
  if (item.ownerType !== "organization") throw new AppError("I contenuti personali non richiedono review manageriale", 409);
  await assertCanManageItem(item, actorUserId, "item.edit");
  const revision = await getExistingWorkingRevision(edition);
  try { requestReview(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { item, edition, revision };
}

async function withdrawEditionReview({ editionId, actorUserId }) {
  const { edition, item } = await getEditionContext(editionId);
  if (item.ownerType !== "organization") throw new AppError("Operazione non applicabile a un contenuto personale", 409);
  await assertCanManageItem(item, actorUserId, "item.edit");
  const revision = await getExistingWorkingRevision(edition);
  try { withdrawReview(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { item, edition, revision };
}

async function requestEditionChanges({ editionId, actorUserId, message }) {
  const { edition, item } = await getEditionContext(editionId);
  if (item.ownerType !== "organization") throw new AppError("Operazione non applicabile a un contenuto personale", 409);
  await assertCanManageItem(item, actorUserId, "item.review");
  const revision = await getExistingWorkingRevision(edition);
  try { requestChanges(revision, actorUserId, message); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { item, edition, revision };
}

async function publishEdition({ editionId, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId, "item.publish");
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: item.ownerType,
    principalId: item.ownerId,
  });
  const revision = await getExistingWorkingRevision(edition);
  assertPinnedNamespaceRevisionCompatible(namespaceAccess, revision.authoredAgainstNamespaceRevisionId);
  if (revision.integrity?.status !== "valid") {
    throw new AppError("La revisione deve superare il controllo di consistenza", 409);
  }
  try {
    if (item.ownerType === "organization") approveReviewAndPublish(revision, actorUserId);
    else publishWithoutReview(revision, actorUserId);
  } catch (error) {
    throw new AppError(error.message, 409, [{ code: error.code }]);
  }
  const previousId = edition.publishedRevisionId;
  await revision.save();
  if (previousId && String(previousId) !== String(revision._id)) {
    await ItemRevisionV2.updateOne({ _id: previousId, status: "published" }, { $set: { status: "superseded" } });
  }
  edition.publishedRevisionId = revision._id;
  edition.workingRevisionId = null;
  await edition.save();
  return { item, edition, revision };
}

module.exports = {
  findItemOrFail,
  assertCanManageItem,
  listItems,
  getItem,
  createEdition,
  updateEdition,
  checkEditionConsistency,
  finalizePrivateEdition,
  requestEditionReview,
  withdrawEditionReview,
  requestEditionChanges,
  publishEdition,
};
