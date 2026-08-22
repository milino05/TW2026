const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { assertCanForkItemEdition } = require("./itemUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { markRevisionEdited, markPublished } = require("./revisionWorkflow.service");
const { clonePresentationForFork, validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const {
  normalizeRevisionPayload,
  validateCreateItemPayload,
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

async function assertCanManageItem(item, actorUserId, minimumOrganizationRole = "operator") {
  return assertCanActForOwner({
    actorUserId,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    minimumOrganizationRole,
  });
}

async function createItem({ payload, actorUserId }) {
  const issues = validateCreateItemPayload(payload || {});
  if (issues.length) throw new AppError("Payload non valido", 400, issues);
  await assertCanActForOwner({ actorUserId, ownerType: payload.ownerType, ownerId: payload.ownerId });
  if (!await Subject.exists({ _id: payload.primarySubjectId })) throw new AppError("Subject non trovato", 404);
  return ItemV2.create({
    primarySubjectId: payload.primarySubjectId,
    ownerType: payload.ownerType,
    ownerId: payload.ownerId,
    provenance: payload.provenance || { origin: "human" },
    createdBy: actorUserId,
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
  const namespace = await Namespace.findOne({ _id: payload.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });
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

async function updateEdition({ editionId, payload, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });
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
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });
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

async function publishEdition({ editionId, actorUserId }) {
  const { edition, item, namespace } = await getEditionContext(editionId);
  await assertCanManageItem(item, actorUserId, "manager");
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });
  const revision = await getWorkingRevision(edition, actorUserId);
  assertPinnedNamespaceRevisionCompatible(namespaceAccess, revision.authoredAgainstNamespaceRevisionId);
  if (revision.integrity?.status !== "valid") {
    throw new AppError("La revisione deve superare il controllo di consistenza", 409);
  }
  try { markPublished(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
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

async function forkItem({ sourceItemId, sourceEditionId, ownerType, ownerId, actorUserId }) {
  await assertCanActForOwner({ actorUserId, ownerType, ownerId });
  const sourceItem = await findItemOrFail(sourceItemId);
  const sourceEdition = await ItemEdition.findOne({ _id: sourceEditionId, itemId: sourceItem._id });
  if (!sourceEdition) throw new AppError("ItemEdition sorgente non disponibile", 404);
  const { access: contentAccess } = await assertCanForkItemEdition({ itemEditionId: sourceEdition._id, actorUserId });
  if (contentAccess.resolvedSnapshotRef?.resourceType !== "item_revision") {
    throw new AppError("Content fork senza ItemRevision autorizzata", 409, [{ code: "AUTHORIZED_ITEM_REVISION_REQUIRED" }]);
  }
  const sourceRevision = await ItemRevisionV2.findOne({
    _id: contentAccess.resolvedSnapshotRef.resourceId,
    itemEditionId: sourceEdition._id,
    status: { $in: ["published", "superseded"] },
  });
  if (!sourceRevision) throw new AppError("ItemRevision sorgente autorizzata non disponibile", 409, [{ code: "AUTHORIZED_ITEM_REVISION_UNAVAILABLE" }]);

  const namespace = await Namespace.findOne({ _id: sourceEdition.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace della Edition sorgente non disponibile", 409);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });
  const targetNamespaceRevision = namespaceAccess.basis === "entitlement"
    ? await resolveNamespaceRevisionForAuthoring({ namespace, access: namespaceAccess })
    : await resolveNamespaceRevision(namespace, sourceRevision.authoredAgainstNamespaceRevisionId);
  const compatibilityIssues = validatePresentationAgainstNamespace(sourceRevision, targetNamespaceRevision);
  if (compatibilityIssues.length) {
    throw new AppError("La revisione sorgente non e compatibile con la NamespaceRevision autorizzata", 409, [{
      code: "FORK_NAMESPACE_INCOMPATIBLE",
      context: { namespaceRevisionId: targetNamespaceRevision._id, issues: compatibilityIssues },
    }]);
  }

  const forkedItem = await ItemV2.create({
    primarySubjectId: sourceItem.primarySubjectId,
    ownerType,
    ownerId,
    provenance: { origin: "forked", sourceItemId: sourceItem._id },
    createdBy: actorUserId,
  });
  let forkedEdition;
  let forkedRevision;
  const createdAdoptions = [];
  try {
    forkedEdition = await ItemEdition.create({
      itemId: forkedItem._id,
      namespaceId: sourceEdition.namespaceId,
      createdBy: actorUserId,
    });
    const presentation = clonePresentationForFork(sourceRevision);
    const payload = revisionPayload(sourceRevision);
    forkedRevision = await ItemRevisionV2.create({
      itemEditionId: forkedEdition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: targetNamespaceRevision._id,
      ...payload,
      ...presentation,
      provenance: { origin: "forked", sourceRevisionId: sourceRevision._id },
      status: "draft",
      integrity: { status: "needs_review", issues: [] },
      review: {},
      publication: {},
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    forkedEdition.workingRevisionId = forkedRevision._id;
    await forkedEdition.save();
    const contentAdoption = await recordAdoptionFromAccess({
      access: contentAccess,
      actorUserId,
      action: "content_fork",
      sourceResourceRef: { resourceType: "item_edition", resourceId: sourceEdition._id },
      sourceSnapshotRef: { resourceType: "item_revision", resourceId: sourceRevision._id },
      resultResourceRef: { resourceType: "item", resourceId: forkedItem._id },
    });
    if (contentAdoption) createdAdoptions.push(contentAdoption);
    const namespaceAdoption = await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: targetNamespaceRevision._id },
      resultResourceRef: { resourceType: "item_edition", resourceId: forkedEdition._id },
    });
    if (namespaceAdoption) createdAdoptions.push(namespaceAdoption);
    return { item: forkedItem, edition: forkedEdition, revision: forkedRevision };
  } catch (error) {
    for (const adoption of createdAdoptions.reverse()) await adoption.deleteOne().catch(() => {});
    await cleanupEditionGraph(forkedEdition);
    await forkedItem.deleteOne().catch(() => {});
    throw error;
  }
}

module.exports = {
  findItemOrFail,
  assertCanManageItem,
  createItem,
  listItems,
  getItem,
  createEdition,
  updateEdition,
  checkEditionConsistency,
  publishEdition,
  forkItem,
};
