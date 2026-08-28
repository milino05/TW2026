const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const {
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  publishWithoutReview,
  approveReviewAndPublish,
} = require("./revisionWorkflow.service");
const {
  DEFINITION_FIELDS,
  ensureDefinitionIds,
} = require("./physicalVocabularyDefinitionIdentity.service");
const { applyPhysicalStarter } = require("./physicalVocabularyStarter.service");
const {
  normalizePhysicalVocabularyRevisionPayload,
  validatePhysicalVocabularyRevisionUnknownFields,
  validatePhysicalVocabularyRevisionSnapshot,
} = require("./validation/physicalVocabulary.validation");

const EMPTY_DEFINITIONS = Object.freeze(Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, []])));

function plain(value) { return value?.toObject ? value.toObject() : value; }

function snapshot(revision) {
  const source = plain(revision) || {};
  return Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, source[field] || []]));
}

function workflowSnapshot(revision) {
  const source = plain(revision) || {};
  return { status: source.status, review: source.review, publication: source.publication };
}

async function findPhysicalVocabularyOrFail(physicalVocabularyId) {
  const physicalVocabulary = await PhysicalVocabulary.findOne({ _id: physicalVocabularyId, lifecycleStatus: "active" });
  if (!physicalVocabulary) throw new AppError("Physical Vocabulary non trovato", 404);
  return physicalVocabulary;
}

async function assertAuthority(physicalVocabulary, actorUserId, permissionCode = "physical_vocabulary.edit") {
  return assertCanActForOwner({
    actorUserId,
    ownerType: physicalVocabulary.ownerType,
    ownerId: physicalVocabulary.ownerId,
    permissionCode,
  });
}

async function nextVersion(physicalVocabularyId) {
  const latest = await PhysicalVocabularyRevision.findOne({ physicalVocabularyId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

function prepareRevisionPayload(rawPayload = {}, baseSnapshot = EMPTY_DEFINITIONS) {
  const unknownIssues = validatePhysicalVocabularyRevisionUnknownFields(rawPayload);
  if (unknownIssues.length) throw new AppError("Payload revisione Physical Vocabulary non valido", 400, unknownIssues);
  const normalized = ensureDefinitionIds(normalizePhysicalVocabularyRevisionPayload(rawPayload));
  const merged = { ...baseSnapshot, ...normalized };
  const issues = validatePhysicalVocabularyRevisionSnapshot(merged);
  if (issues.length) throw new AppError("Definizioni Physical Vocabulary non valide", 400, issues);
  return { normalized, merged };
}

async function createInitialRevisionForPhysicalVocabulary({ physicalVocabularyId, actorUserId, payload = {}, applyStarter = false }) {
  const prepared = prepareRevisionPayload(payload, EMPTY_DEFINITIONS);
  const definitions = applyStarter ? applyPhysicalStarter(prepared.merged).snapshot : prepared.merged;
  const issues = validatePhysicalVocabularyRevisionSnapshot(definitions);
  if (issues.length) throw new AppError("Starter Physical Vocabulary non valido", 500, issues);
  return PhysicalVocabularyRevision.create({
    physicalVocabularyId,
    version: 1,
    ...definitions,
    status: "draft",
    integrity: { status: "needs_review", issues: [], checkedAt: null, checkedBy: null },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

async function createWorkingFromPublished(physicalVocabulary, actorUserId) {
  if (!physicalVocabulary.publishedRevisionId) throw new AppError("Nessuna revisione Physical Vocabulary pubblicata da clonare", 409);
  const published = await PhysicalVocabularyRevision.findById(physicalVocabulary.publishedRevisionId);
  if (!published) throw new AppError("Revisione Physical Vocabulary pubblicata non trovata", 409);
  const revision = await PhysicalVocabularyRevision.create({
    physicalVocabularyId: physicalVocabulary._id,
    version: await nextVersion(physicalVocabulary._id),
    basedOnRevisionId: published._id,
    ...snapshot(published),
    status: "draft",
    integrity: { status: "needs_review", issues: [], checkedAt: null, checkedBy: null },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  const switched = await PhysicalVocabulary.updateOne(
    { _id: physicalVocabulary._id, workingRevisionId: null, publishedRevisionId: published._id, lifecycleStatus: "active" },
    { $set: { workingRevisionId: revision._id } },
  );
  if (switched.modifiedCount !== 1) {
    await revision.deleteOne().catch(() => {});
    throw new AppError("Il Physical Vocabulary e cambiato durante la creazione della revisione", 409, [{ code: "PHYSICAL_VOCABULARY_CONCURRENT_EDIT" }]);
  }
  physicalVocabulary.workingRevisionId = revision._id;
  return revision;
}

async function getWorking(physicalVocabulary, actorUserId, { create = true } = {}) {
  if (physicalVocabulary.workingRevisionId) {
    const revision = await PhysicalVocabularyRevision.findById(physicalVocabulary.workingRevisionId);
    if (!revision) throw new AppError("Revisione Physical Vocabulary di lavoro non trovata", 409);
    return revision;
  }
  if (!create) throw new AppError("Nessuna revisione Physical Vocabulary di lavoro", 404);
  return createWorkingFromPublished(physicalVocabulary, actorUserId);
}

async function getPublishedPhysicalVocabularyRevision({ physicalVocabularyId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  if (!physicalVocabulary.publishedRevisionId) throw new AppError("Physical Vocabulary pubblicato non disponibile", 404);
  const revision = await PhysicalVocabularyRevision.findById(physicalVocabulary.publishedRevisionId);
  if (!revision) throw new AppError("Revisione Physical Vocabulary pubblicata non trovata", 409);
  return { physicalVocabulary, revision };
}

async function getWorkingPhysicalVocabularyRevision({ physicalVocabularyId, actorUserId, create = false }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  await assertAuthority(physicalVocabulary, actorUserId);
  const revision = await getWorking(physicalVocabulary, actorUserId, { create });
  return { physicalVocabulary, revision };
}

async function updatePhysicalVocabularyDraft({ physicalVocabularyId, actorUserId, payload }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  await assertAuthority(physicalVocabulary, actorUserId);
  const revision = await getWorking(physicalVocabulary, actorUserId, { create: true });
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
  return { physicalVocabulary, revision };
}

async function applyStarterToPhysicalVocabularyDraft({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  await assertAuthority(physicalVocabulary, actorUserId);
  const revision = await getWorking(physicalVocabulary, actorUserId, { create: true });
  try { markRevisionEdited(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  const result = applyPhysicalStarter(snapshot(revision));
  const issues = validatePhysicalVocabularyRevisionSnapshot(result.snapshot);
  if (issues.length) throw new AppError("Applicazione starter non valida", 400, issues);
  for (const field of DEFINITION_FIELDS) revision[field] = result.snapshot[field];
  revision.updatedBy = actorUserId;
  await revision.save();
  return { physicalVocabulary, revision, applied: result.applied, conflicts: result.conflicts };
}

async function evaluatePhysicalVocabulary({
  physicalVocabularyId,
  actorUserId,
  allowInReview = false,
  authorityPermissionCode = "physical_vocabulary.edit",
}) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  await assertAuthority(physicalVocabulary, actorUserId, authorityPermissionCode);
  const revision = await getWorking(physicalVocabulary, actorUserId, { create: true });
  if (revision.status === "in_review" && !allowInReview) throw new AppError("Una revisione in_review e bloccata", 409);
  const issues = validatePhysicalVocabularyRevisionSnapshot(snapshot(revision));
  revision.integrity = {
    status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid",
    issues,
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  await revision.save();
  return { physicalVocabulary, revision, issues };
}

async function requestPhysicalVocabularyReview({ physicalVocabularyId, actorUserId }) {
  const result = await evaluatePhysicalVocabulary({ physicalVocabularyId, actorUserId });
  if (result.physicalVocabulary.ownerType !== "organization") throw new AppError("I Physical Vocabulary personali non richiedono review manageriale", 409);
  if (result.issues.some((issue) => issue.severity !== "warning")) throw new AppError("Il Physical Vocabulary contiene problemi bloccanti", 400, result.issues);
  try { requestReview(result.revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await result.revision.save();
  return result;
}

async function withdrawPhysicalVocabularyReview({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  if (physicalVocabulary.ownerType !== "organization") throw new AppError("Operazione non applicabile a un Physical Vocabulary personale", 409);
  await assertAuthority(physicalVocabulary, actorUserId);
  const revision = await getWorking(physicalVocabulary, actorUserId, { create: false });
  try { withdrawReview(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { physicalVocabulary, revision };
}

async function requestPhysicalVocabularyChanges({ physicalVocabularyId, actorUserId, message }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  if (physicalVocabulary.ownerType !== "organization") throw new AppError("Operazione non applicabile a un Physical Vocabulary personale", 409);
  await assertAuthority(physicalVocabulary, actorUserId, "physical_vocabulary.review");
  const revision = await getWorking(physicalVocabulary, actorUserId, { create: false });
  try { requestChanges(revision, actorUserId, message); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { physicalVocabulary, revision };
}

async function compensatePublish({ physicalVocabulary, revision, previousId, previousRevisionState, previousSuperseded }) {
  const pointer = await PhysicalVocabulary.updateOne(
    { _id: physicalVocabulary._id, publishedRevisionId: revision._id, workingRevisionId: null },
    { $set: { publishedRevisionId: previousId || null, workingRevisionId: revision._id } },
  );
  let previous = { modifiedCount: 1 };
  if (previousId && previousSuperseded) previous = await PhysicalVocabularyRevision.updateOne({ _id: previousId, status: "superseded" }, { $set: { status: "published" } });
  await PhysicalVocabularyRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState });
  if (pointer.modifiedCount !== 1 || previous.modifiedCount !== 1) {
    throw new AppError("Rollback pubblicazione Physical Vocabulary incompleto", 500, [{ code: "PHYSICAL_VOCABULARY_PUBLISH_ROLLBACK_FAILED" }]);
  }
}

async function publishPhysicalVocabulary({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail(physicalVocabularyId);
  await assertAuthority(physicalVocabulary, actorUserId, "physical_vocabulary.publish");
  const result = await evaluatePhysicalVocabulary({
    physicalVocabularyId,
    actorUserId,
    allowInReview: true,
    authorityPermissionCode: "physical_vocabulary.publish",
  });
  const { revision, issues } = result;
  if (issues.some((issue) => issue.severity !== "warning")) throw new AppError("Impossibile pubblicare il Physical Vocabulary", 400, issues);

  const previousId = physicalVocabulary.publishedRevisionId;
  const previousRevisionState = workflowSnapshot(revision);
  try {
    if (physicalVocabulary.ownerType === "organization") approveReviewAndPublish(revision, actorUserId);
    else publishWithoutReview(revision, actorUserId);
  } catch (error) {
    throw new AppError(error.message, 409, [{ code: error.code }]);
  }
  await revision.save();

  let pointerSwitched = false;
  let previousSuperseded = false;
  try {
    const pointer = await PhysicalVocabulary.updateOne(
      { _id: physicalVocabulary._id, workingRevisionId: revision._id, lifecycleStatus: "active" },
      { $set: { publishedRevisionId: revision._id, workingRevisionId: null } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La revisione Physical Vocabulary e cambiata durante la pubblicazione", 409);
    pointerSwitched = true;
    if (previousId) {
      const previous = await PhysicalVocabularyRevision.updateOne({ _id: previousId, status: "published" }, { $set: { status: "superseded" } });
      if (previous.modifiedCount !== 1) throw new Error("Impossibile supersedere la revisione precedente");
      previousSuperseded = true;
    }
  } catch (error) {
    if (pointerSwitched) await compensatePublish({ physicalVocabulary, revision, previousId, previousRevisionState, previousSuperseded });
    else await PhysicalVocabularyRevision.updateOne({ _id: revision._id }, { $set: previousRevisionState }).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione Physical Vocabulary annullata per errore di consistenza", 500, [{ code: "PHYSICAL_VOCABULARY_PUBLISH_FAILED", message: error.message }]);
  }

  physicalVocabulary.publishedRevisionId = revision._id;
  physicalVocabulary.workingRevisionId = null;
  return { physicalVocabulary, revision };
}

function materializePhysicalVocabularyRevision({ physicalVocabulary, revision }) {
  return {
    physicalVocabularyId: physicalVocabulary._id,
    name: physicalVocabulary.name,
    description: physicalVocabulary.description,
    ownerType: physicalVocabulary.ownerType,
    ownerId: physicalVocabulary.ownerId,
    revisionId: revision._id,
    version: revision.version,
    ...snapshot(revision),
  };
}

module.exports = {
  EMPTY_DEFINITIONS,
  snapshot,
  createInitialRevisionForPhysicalVocabulary,
  getPublishedPhysicalVocabularyRevision,
  getWorkingPhysicalVocabularyRevision,
  updatePhysicalVocabularyDraft,
  applyStarterToPhysicalVocabularyDraft,
  evaluatePhysicalVocabulary,
  requestPhysicalVocabularyReview,
  withdrawPhysicalVocabularyReview,
  requestPhysicalVocabularyChanges,
  compensatePublish,
  publishPhysicalVocabulary,
  materializePhysicalVocabularyRevision,
};
