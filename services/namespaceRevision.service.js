const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const {
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  markPublished,
} = require("./revisionWorkflow.service");
const {
  DEFINITION_FIELDS,
  ensureDefinitionIds,
} = require("./namespaceDefinitionIdentity.service");
const {
  normalizeNamespaceRevisionPayload,
  validateNamespaceRevisionUnknownFields,
  validateNamespaceRevisionSnapshot,
} = require("./validation/namespace.validation");

const EMPTY_DEFINITIONS = Object.freeze(Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, []])));

function plain(value) {
  return value?.toObject ? value.toObject() : value;
}

function snapshot(revision) {
  const source = plain(revision) || {};
  return Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, source[field] || []]));
}

function workflowSnapshot(revision) {
  const source = plain(revision) || {};
  return { status: source.status, review: source.review, publication: source.publication };
}

async function findNamespaceOrFail(namespaceId) {
  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  return namespace;
}

async function assertNamespaceAuthority(namespace, actorUserId, minimumOrganizationRole = "operator") {
  return assertCanActForOwner({
    actorUserId,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    minimumOrganizationRole,
  });
}

async function nextVersion(namespaceId) {
  const latest = await NamespaceRevision.findOne({ namespaceId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

function validatePreparedSnapshot(prepared, { requireCoreScales = false } = {}) {
  const issues = validateNamespaceRevisionSnapshot(prepared, { requireCoreScales });
  if (issues.length) throw new AppError("Definizioni Namespace non valide", 400, issues);
}

function prepareRevisionPayload(rawPayload = {}, baseSnapshot = EMPTY_DEFINITIONS) {
  const unknownIssues = validateNamespaceRevisionUnknownFields(rawPayload);
  if (unknownIssues.length) throw new AppError("Payload revisione Namespace non valido", 400, unknownIssues);
  const normalized = ensureDefinitionIds(normalizeNamespaceRevisionPayload(rawPayload));
  const merged = { ...baseSnapshot, ...normalized };
  validatePreparedSnapshot(merged, { requireCoreScales: false });
  return { normalized, merged };
}

async function createInitialRevisionForNamespace({ namespaceId, actorUserId, payload = {} }) {
  const { merged } = prepareRevisionPayload(payload, EMPTY_DEFINITIONS);
  return NamespaceRevision.create({
    namespaceId,
    version: 1,
    ...merged,
    status: "draft",
    integrity: { status: "needs_review", issues: [], checkedAt: null, checkedBy: null },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

async function createWorkingFromPublished(namespace, actorUserId) {
  if (!namespace.publishedRevisionId) throw new AppError("Nessuna revisione Namespace pubblicata da clonare", 409);
  const published = await NamespaceRevision.findById(namespace.publishedRevisionId);
  if (!published) throw new AppError("Revisione Namespace pubblicata non trovata", 409);
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: await nextVersion(namespace._id),
    basedOnRevisionId: published._id,
    ...snapshot(published),
    status: "draft",
    integrity: { status: "needs_review", issues: [], checkedAt: null, checkedBy: null },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  namespace.workingRevisionId = revision._id;
  await namespace.save();
  return revision;
}

async function getWorking(namespace, actorUserId, { create = true } = {}) {
  if (namespace.workingRevisionId) {
    const revision = await NamespaceRevision.findById(namespace.workingRevisionId);
    if (!revision) throw new AppError("Revisione Namespace di lavoro non trovata", 409);
    return revision;
  }
  if (!create) throw new AppError("Nessuna revisione Namespace di lavoro", 404);
  return createWorkingFromPublished(namespace, actorUserId);
}

async function getPublishedNamespaceRevision({ namespaceId }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  if (!namespace.publishedRevisionId) throw new AppError("Namespace pubblicato non disponibile", 404);
  const revision = await NamespaceRevision.findById(namespace.publishedRevisionId);
  if (!revision) throw new AppError("Revisione Namespace pubblicata non trovata", 409);
  return { namespace, revision };
}

async function getWorkingNamespaceRevision({ namespaceId, actorUserId, create = false }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "operator");
  const revision = await getWorking(namespace, actorUserId, { create });
  return { namespace, revision };
}

async function updateNamespaceDraft({ namespaceId, actorUserId, payload }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "operator");
  const revision = await getWorking(namespace, actorUserId, { create: true });
  let prepared;
  try {
    prepared = prepareRevisionPayload(payload || {}, snapshot(revision));
    markRevisionEdited(revision, actorUserId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message, 409, [{ code: error.code }]);
  }
  for (const [field, value] of Object.entries(prepared.normalized)) revision[field] = value;
  revision.updatedBy = actorUserId;
  await revision.save();
  return { namespace, revision };
}

async function evaluateNamespace({ namespaceId, actorUserId, allowInReview = false }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "operator");
  const revision = await getWorking(namespace, actorUserId, { create: true });
  if (revision.status === "in_review" && !allowInReview) throw new AppError("Una revisione in_review e bloccata", 409);
  const issues = validateNamespaceRevisionSnapshot(snapshot(revision), { requireCoreScales: true });
  revision.integrity = {
    status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid",
    issues,
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  await revision.save();
  return { namespace, revision, issues };
}

async function requestNamespaceReview({ namespaceId, actorUserId }) {
  const result = await evaluateNamespace({ namespaceId, actorUserId });
  if (result.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Il Namespace contiene problemi bloccanti", 400, result.issues);
  try { requestReview(result.revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await result.revision.save();
  return result;
}

async function withdrawNamespaceReview({ namespaceId, actorUserId }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "operator");
  const revision = await getWorking(namespace, actorUserId, { create: false });
  try { withdrawReview(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { namespace, revision };
}

async function requestNamespaceChanges({ namespaceId, actorUserId, message }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "manager");
  const revision = await getWorking(namespace, actorUserId, { create: false });
  try { requestChanges(revision, actorUserId, message); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { namespace, revision };
}

async function compensateNamespacePublish({ namespace, revision, previousId, previousRevisionState, previousSuperseded }) {
  const pointer = await Namespace.updateOne(
    { _id: namespace._id, publishedRevisionId: revision._id, workingRevisionId: null },
    { $set: { publishedRevisionId: previousId || null, workingRevisionId: revision._id } },
  );
  let previous = { modifiedCount: 1 };
  if (previousId && previousSuperseded) {
    previous = await NamespaceRevision.updateOne({ _id: previousId, status: "superseded" }, { $set: { status: "published" } });
  }
  await NamespaceRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState });
  if (pointer.modifiedCount !== 1 || previous.modifiedCount !== 1) {
    throw new AppError("Rollback pubblicazione Namespace incompleto", 500, [{ code: "NAMESPACE_PUBLISH_ROLLBACK_FAILED" }]);
  }
}

async function publishNamespace({ namespaceId, actorUserId }) {
  const namespace = await findNamespaceOrFail(namespaceId);
  await assertNamespaceAuthority(namespace, actorUserId, "manager");
  const result = await evaluateNamespace({ namespaceId, actorUserId, allowInReview: true });
  const { revision, issues } = result;
  if (issues.some((issue) => issue.severity !== "warning")) throw new AppError("Impossibile pubblicare il Namespace", 400, issues);

  const previousId = namespace.publishedRevisionId;
  const previousRevisionState = workflowSnapshot(revision);
  try { markPublished(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();

  let pointerSwitched = false;
  let previousSuperseded = false;
  try {
    const pointer = await Namespace.updateOne(
      { _id: namespace._id, workingRevisionId: revision._id, lifecycleStatus: "active" },
      { $set: { publishedRevisionId: revision._id, workingRevisionId: null } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La revisione Namespace e cambiata durante la pubblicazione", 409);
    pointerSwitched = true;
    if (previousId) {
      const previous = await NamespaceRevision.updateOne({ _id: previousId, status: "published" }, { $set: { status: "superseded" } });
      if (previous.modifiedCount !== 1) throw new Error("Impossibile supersedere il Namespace precedente");
      previousSuperseded = true;
    }
  } catch (error) {
    if (pointerSwitched) {
      try {
        await compensateNamespacePublish({ namespace, revision, previousId, previousRevisionState, previousSuperseded });
      } catch (rollbackError) {
        if (rollbackError instanceof AppError) throw rollbackError;
        throw new AppError("Rollback pubblicazione Namespace incompleto", 500, [
          { code: "NAMESPACE_PUBLISH_ROLLBACK_FAILED", message: rollbackError.message },
          { code: "ORIGINAL_ERROR", message: error.message },
        ]);
      }
    } else {
      await NamespaceRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState }).catch(() => {});
    }
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione Namespace annullata per errore di consistenza", 500, [{ code: "NAMESPACE_PUBLISH_FAILED", message: error.message }]);
  }

  namespace.publishedRevisionId = revision._id;
  namespace.workingRevisionId = null;
  return { namespace, revision };
}

function materializeNamespaceRevision({ namespace, revision }) {
  return {
    namespaceId: namespace._id,
    name: namespace.name,
    description: namespace.description,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    revisionId: revision._id,
    version: revision.version,
    ...snapshot(revision),
  };
}

module.exports = {
  EMPTY_DEFINITIONS,
  snapshot,
  createInitialRevisionForNamespace,
  getPublishedNamespaceRevision,
  getWorkingNamespaceRevision,
  updateNamespaceDraft,
  evaluateNamespace,
  requestNamespaceReview,
  withdrawNamespaceReview,
  requestNamespaceChanges,
  compensateNamespacePublish,
  publishNamespace,
  materializeNamespaceRevision,
};
