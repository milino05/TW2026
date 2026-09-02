const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}
function workingConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}
function normalizeCurationSignals(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new AppError("curationSignals deve essere un array", 400, [{ field: "curationSignals", code: "INVALID_TYPE" }]);
  const seen = new Set();
  return value.map((entry, index) => {
    const definitionId = String(entry?.definitionId || "").trim();
    const weight = entry?.weight === undefined ? 1 : Number(entry.weight);
    if (!definitionId) throw new AppError("definitionId obbligatorio", 400, [{ field: `curationSignals[${index}].definitionId`, code: "REQUIRED" }]);
    if (seen.has(definitionId)) throw new AppError("Curation signal duplicato", 400, [{ field: `curationSignals[${index}].definitionId`, code: "DUPLICATE" }]);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new AppError("Peso curation signal non valido", 400, [{ field: `curationSignals[${index}].weight`, code: "OUT_OF_RANGE" }]);
    seen.add(definitionId);
    return { definitionId, weight };
  });
}
function escapedRegex(value) {
  return new RegExp(String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function findContextOrFail(editorialContextId, { session = null } = {}) {
  const query = EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (session) query.session(session);
  const context = await query;
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  return context;
}

function assertWorkingStateEditable(context) {
  if (context.activeReviewRevisionId) {
    throw new AppError("La raccolta è bloccata mentre una revisione è attiva", 409, [{
      code: "EDITORIAL_CONTEXT_REVIEW_LOCKED",
      context: { activeReviewRevisionId: context.activeReviewRevisionId },
    }]);
  }
}

async function assertCanEditContext(context, actorUserId) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.edit");
  return contentSpace;
}

async function assertEditionUsage({ contentSpace, itemEditionId, actorUserId }) {
  return assertCanUseItemEditionForEditorialRelease({
    itemEditionId,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
}

async function resolveEligibleEdition(context, itemEditionId, { session = null } = {}) {
  assertObjectId(itemEditionId, "itemEditionId");
  let editionQuery = ItemEdition.findById(itemEditionId);
  if (session) editionQuery = editionQuery.session(session);
  const edition = await editionQuery.lean();
  if (!edition) throw new AppError("Versione editoriale non trovata", 404);
  if (id(edition.namespaceId) !== id(context.namespaceId)) {
    throw new AppError("La versione editoriale usa regole diverse dalla raccolta", 409, [{
      field: "itemEditionId",
      code: "ITEM_EDITION_NAMESPACE_MISMATCH",
    }]);
  }
  let itemQuery = ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" });
  let membershipQuery = ContentSpaceMembership.findOne({ contentSpaceId: context.contentSpaceId, itemId: edition.itemId });
  if (session) { itemQuery = itemQuery.session(session); membershipQuery = membershipQuery.session(session); }
  const [item, membership] = await Promise.all([itemQuery.lean(), membershipQuery.lean()]);
  if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE" }]);
  if (!membership) {
    throw new AppError("Il contenuto deve appartenere allo spazio editoriale della raccolta", 409, [{
      field: "itemEditionId",
      code: "ITEM_NOT_IN_CONTENT_SPACE",
    }]);
  }
  return { edition, item };
}

async function bumpWorkingVersion({ context, session }) {
  const pointer = await EditorialContext.updateOne({
    _id: context._id,
    lifecycleStatus: "active",
    activeReviewRevisionId: null,
    workingVersion: Number(context.workingVersion || 0),
  }, { $inc: { workingVersion: 1 } }, { session });
  if (pointer.modifiedCount !== 1) throw workingConflict();
}

async function addEditorialContextEntry({ editorialContextId, itemEditionId, curationSignals = [], actorUserId }) {
  const initial = await findContextOrFail(editorialContextId);
  const contentSpace = await assertCanEditContext(initial, actorUserId);
  assertWorkingStateEditable(initial);
  await assertEditionUsage({ contentSpace, itemEditionId, actorUserId });
  const normalizedSignals = normalizeCurationSignals(curationSignals) || [];
  let created = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const context = await findContextOrFail(editorialContextId, { session });
      assertWorkingStateEditable(context);
      await resolveEligibleEdition(context, itemEditionId, { session });
      [created] = await EditorialContextEntry.create([{
        editorialContextId: context._id,
        itemEditionId,
        curationSignals: normalizedSignals,
        addedBy: actorUserId,
        updatedBy: actorUserId,
      }], { session });
      await bumpWorkingVersion({ context, session });
    });
    return created;
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Contenuto già presente nella raccolta", 409, [{ code: "EDITORIAL_CONTEXT_ENTRY_EXISTS" }]);
    throw error;
  }
}

async function updateEditorialContextEntry({ editorialContextId, entryId, curationSignals, actorUserId }) {
  assertObjectId(entryId, "entryId");
  const initial = await findContextOrFail(editorialContextId);
  const contentSpace = await assertCanEditContext(initial, actorUserId);
  assertWorkingStateEditable(initial);
  const normalizedSignals = normalizeCurationSignals(curationSignals);
  if (normalizedSignals === null) throw new AppError("Nessuna modifica specificata", 400);
  const existingEntry = await EditorialContextEntry.findOne({ _id: entryId, editorialContextId: initial._id }).select("itemEditionId").lean();
  if (!existingEntry) throw new AppError("Contenuto della raccolta non trovato", 404);
  await assertEditionUsage({ contentSpace, itemEditionId: existingEntry.itemEditionId, actorUserId });
  let updated = null;
  await mongoose.connection.transaction(async (session) => {
    const context = await findContextOrFail(editorialContextId, { session });
    assertWorkingStateEditable(context);
    const entry = await EditorialContextEntry.findOne({ _id: entryId, editorialContextId: context._id }).session(session);
    if (!entry) throw new AppError("Contenuto della raccolta non trovato", 404);
    await resolveEligibleEdition(context, entry.itemEditionId, { session });
    entry.curationSignals = normalizedSignals;
    entry.updatedBy = actorUserId;
    await entry.save({ session });
    await bumpWorkingVersion({ context, session });
    updated = entry;
  });
  return updated;
}

async function removeEditorialContextEntry({ editorialContextId, entryId, actorUserId }) {
  assertObjectId(entryId, "entryId");
  const initial = await findContextOrFail(editorialContextId);
  await assertCanEditContext(initial, actorUserId);
  assertWorkingStateEditable(initial);
  await mongoose.connection.transaction(async (session) => {
    const context = await findContextOrFail(editorialContextId, { session });
    assertWorkingStateEditable(context);
    const result = await EditorialContextEntry.deleteOne({ _id: entryId, editorialContextId: context._id }, { session });
    if (result.deletedCount !== 1) throw new AppError("Contenuto della raccolta non trovato", 404);
    await bumpWorkingVersion({ context, session });
  });
  return { removed: true };
}

async function editionIdsMatchingQuery(context, q) {
  const normalized = String(q || "").trim();
  if (!normalized) return null;
  const pattern = escapedRegex(normalized);
  const [subjects, matchingRevisions] = await Promise.all([
    Subject.find({ $or: [{ preferredLabel: pattern }, { description: pattern }] }).select("_id").limit(500).lean(),
    ItemRevisionV2.find({ label: pattern }).select("itemEditionId").limit(500).lean(),
  ]);
  const subjectIds = subjects.map((entry) => entry._id);
  const subjectItems = subjectIds.length
    ? await ItemV2.find({ primarySubjectId: { $in: subjectIds }, lifecycleStatus: "active" }).select("_id").limit(1000).lean()
    : [];
  const itemIds = subjectItems.map((entry) => entry._id);
  const revisionEditionIds = matchingRevisions.map((entry) => entry.itemEditionId);
  const clauses = [];
  if (itemIds.length) clauses.push({ itemId: { $in: itemIds } });
  if (revisionEditionIds.length) clauses.push({ _id: { $in: revisionEditionIds } });
  if (!clauses.length) return [];
  const editions = await ItemEdition.find({
    namespaceId: context.namespaceId,
    $or: clauses,
  }).select("_id").limit(1500).lean();
  return editions.map((entry) => entry._id);
}

async function listEditorialContextEntries({ editorialContextId, actorUserId, q = "", page = 1, limit = 50 }) {
  const context = await findContextOrFail(editorialContextId);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const matchingEditionIds = await editionIdsMatchingQuery(context, q);
  const query = { editorialContextId: context._id };
  if (matchingEditionIds) query.itemEditionId = { $in: matchingEditionIds };
  const [total, entries] = await Promise.all([
    EditorialContextEntry.countDocuments(query),
    EditorialContextEntry.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const editions = entries.length
    ? await ItemEdition.find({ _id: { $in: entries.map((entry) => entry.itemEditionId) } }).lean()
    : [];
  const editionById = new Map(editions.map((edition) => [id(edition), edition]));
  const itemIds = [...new Set(editions.map((edition) => id(edition.itemId)))];
  const items = itemIds.length ? await ItemV2.find({ _id: { $in: itemIds } }).lean() : [];
  const itemById = new Map(items.map((item) => [id(item), item]));
  const revisionIds = [...new Set(editions.map((edition) => id(edition.workingRevisionId || edition.publishedRevisionId)).filter(Boolean))];
  const revisions = revisionIds.length ? await ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label status version").lean() : [];
  const revisionById = new Map(revisions.map((revision) => [id(revision), revision]));
  const subjectIds = [...new Set(items.map((item) => id(item.primarySubjectId)).filter(Boolean))];
  const subjects = subjectIds.length ? await Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description").lean() : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject), subject]));

  return {
    context: { id: context._id, name: context.displayName, workingVersion: context.workingVersion || 0, activeReviewRevisionId: context.activeReviewRevisionId || null },
    results: entries.map((entry) => {
      const edition = editionById.get(id(entry.itemEditionId)) || null;
      const item = edition ? itemById.get(id(edition.itemId)) || null : null;
      const revision = edition ? revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null : null;
      const subject = item ? subjectById.get(id(item.primarySubjectId)) || null : null;
      return { entry, edition, item, revision, subject };
    }),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
  };
}

module.exports = {
  findContextOrFail,
  assertWorkingStateEditable,
  assertCanEditContext,
  resolveEligibleEdition,
  addEditorialContextEntry,
  updateEditorialContextEntry,
  removeEditorialContextEntry,
  listEditorialContextEntries,
};