const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanReferenceItemInEditorialSpace } = require("./itemUsageAuthorization.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}
function workingConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}
function graphConflict() {
  return new AppError("Il grafo semantico è stato modificato da un'altra operazione", 409, [{ code: "SEMANTIC_GRAPH_WORKING_CONFLICT" }]);
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

async function resolveEligibleItem(context, itemId, { session = null } = {}) {
  assertObjectId(itemId, "itemId");
  let itemQuery = ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" });
  let membershipQuery = ContentSpaceItemMembership.findOne({ contentSpaceId: context.contentSpaceId, itemId });
  if (session) { itemQuery = itemQuery.session(session); membershipQuery = membershipQuery.session(session); }
  const [item, membership] = await Promise.all([itemQuery.lean(), membershipQuery.lean()]);
  if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE" }]);
  if (!membership) {
    throw new AppError("Il contenuto deve appartenere allo spazio editoriale della raccolta", 409, [{
      field: "itemId",
      code: "ITEM_NOT_IN_CONTENT_SPACE",
    }]);
  }
  let editionQuery = ItemEdition.findOne({ itemId: item._id, namespaceId: context.namespaceId });
  if (session) editionQuery = editionQuery.session(session);
  const edition = await editionQuery.lean();
  return { item, edition: edition || null };
}

async function ensureSpaceSubjectMembership({ context, subjectId, actorUserId, session }) {
  await ContentSpaceSubjectMembership.findOneAndUpdate(
    { contentSpaceId: context.contentSpaceId, subjectId },
    { $setOnInsert: { contentSpaceId: context.contentSpaceId, subjectId, addedBy: actorUserId } },
    { upsert: true, new: true, session },
  );
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

async function addEditorialContextEntry({ editorialContextId, itemId, curationSignals = [], actorUserId }) {
  const initial = await findContextOrFail(editorialContextId);
  const contentSpace = await assertCanEditContext(initial, actorUserId);
  assertWorkingStateEditable(initial);
  const normalizedSignals = normalizeCurationSignals(curationSignals) || [];
  let created = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const context = await findContextOrFail(editorialContextId, { session });
      assertWorkingStateEditable(context);
      const { item } = await resolveEligibleItem(context, itemId, { session });
      await assertCanReferenceItemInEditorialSpace({
        itemId: item._id,
        actorUserId,
        principalType: contentSpace.ownerType,
        principalId: contentSpace.ownerId,
      });
      await ensureSpaceSubjectMembership({ context, subjectId: item.primarySubjectId, actorUserId, session });
      [created] = await CollectionItemMembership.create([{
        editorialContextId: context._id,
        itemId: item._id,
        curationSignals: normalizedSignals,
        addedBy: actorUserId,
        updatedBy: actorUserId,
      }], { session });
      await bumpWorkingVersion({ context, session });
    });
    return created;
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Contenuto già presente nella raccolta", 409, [{ code: "COLLECTION_ITEM_MEMBERSHIP_EXISTS" }]);
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
  let updated = null;
  await mongoose.connection.transaction(async (session) => {
    const context = await findContextOrFail(editorialContextId, { session });
    assertWorkingStateEditable(context);
    const membership = await CollectionItemMembership.findOne({ _id: entryId, editorialContextId: context._id }).session(session);
    if (!membership) throw new AppError("Contenuto della raccolta non trovato", 404);
    const { item } = await resolveEligibleItem(context, membership.itemId, { session });
    await assertCanReferenceItemInEditorialSpace({
      itemId: item._id,
      actorUserId,
      principalType: contentSpace.ownerType,
      principalId: contentSpace.ownerId,
    });
    membership.curationSignals = normalizedSignals;
    membership.updatedBy = actorUserId;
    await membership.save({ session });
    await bumpWorkingVersion({ context, session });
    updated = membership;
  });
  return updated;
}

async function remainingCollectionItemsForSubject({ context, subjectId, excludingEntryId, session }) {
  const memberships = await CollectionItemMembership.find({
    editorialContextId: context._id,
    _id: { $ne: excludingEntryId },
  }).select("itemId").session(session).lean();
  if (!memberships.length) return [];
  const items = await ItemV2.find({
    _id: { $in: memberships.map((entry) => entry.itemId) },
    primarySubjectId: subjectId,
    lifecycleStatus: "active",
  }).select("_id").session(session).lean();
  return items;
}

async function nextGraphVersion(semanticGraphId, session) {
  const latest = await SemanticGraphRevision.findOne({ semanticGraphId }).sort({ version: -1 }).select("version").session(session).lean();
  return (latest?.version || 0) + 1;
}

function graphSnapshotWithoutSubject(graph, subjectId) {
  if (!graph) return { subjectBindings: [], edges: [], removedRelationCount: 0, contained: false };
  const contained = [...graph.nodes.values()].some((node) => node.binding && sameId(node.subject, subjectId));
  const subjectBindings = [...graph.nodes.values()]
    .filter((node) => node.binding && !sameId(node.subject, subjectId))
    .map((node) => ({
      subjectId: node.subject._id,
      subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
    }));
  const removedEdges = graph.authoritativeEdges.filter((edge) => sameId(edge.sourceSubjectId, subjectId) || sameId(edge.targetSubjectId, subjectId));
  const edges = graph.authoritativeEdges
    .filter((edge) => !sameId(edge.sourceSubjectId, subjectId) && !sameId(edge.targetSubjectId, subjectId))
    .map((edge) => ({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance || { origin: "human" },
    }));
  return { subjectBindings, edges, removedRelationCount: removedEdges.length, contained };
}

async function writeGraphSnapshot({ semanticGraph, sourceGraph, snapshot, actorUserId, session }) {
  const lockedGraph = await SemanticGraph.findOne({
    _id: semanticGraph._id,
    lifecycleStatus: "active",
    workingVersion: Number(semanticGraph.workingVersion || 0),
    workingRevisionId: semanticGraph.workingRevisionId || null,
  }).session(session);
  if (!lockedGraph) throw graphConflict();
  const [revision] = await SemanticGraphRevision.create([{
    semanticGraphId: lockedGraph._id,
    version: await nextGraphVersion(lockedGraph._id, session),
    basedOnRevisionId: lockedGraph.workingRevisionId || null,
    authoredAgainstNamespaceRevisionId: sourceGraph.revision.authoredAgainstNamespaceRevisionId,
    createdBy: actorUserId,
  }], { session });
  if (snapshot.subjectBindings.length) {
    await GraphSubjectBinding.insertMany(snapshot.subjectBindings.map((binding) => ({
      graphRevisionId: revision._id,
      subjectId: binding.subjectId,
      subjectClassDefinitionIds: binding.subjectClassDefinitionIds || [],
    })), { session, ordered: true });
  }
  if (snapshot.edges.length) {
    await SemanticEdgeV2.insertMany(snapshot.edges.map((edge) => ({
      graphRevisionId: revision._id,
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance || { origin: "human" },
    })), { session, ordered: true });
  }
  lockedGraph.workingRevisionId = revision._id;
  lockedGraph.workingVersion = Number(semanticGraph.workingVersion || 0) + 1;
  await lockedGraph.save({ session });
  return revision;
}

async function removeEditorialContextEntry({ editorialContextId, entryId, cascadeGraph = false, actorUserId }) {
  assertObjectId(entryId, "entryId");
  const initial = await findContextOrFail(editorialContextId);
  await assertCanEditContext(initial, actorUserId);
  assertWorkingStateEditable(initial);
  const semanticGraph = await SemanticGraph.findOne({ _id: initial.semanticGraphId, lifecycleStatus: "active" });
  const sourceGraph = semanticGraph?.workingRevisionId ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId) : null;
  let removal = { removed: true, removedGraphSubject: false, removedRelationCount: 0 };

  await mongoose.connection.transaction(async (session) => {
    const context = await findContextOrFail(editorialContextId, { session });
    assertWorkingStateEditable(context);
    const membership = await CollectionItemMembership.findOne({ _id: entryId, editorialContextId: context._id }).session(session);
    if (!membership) throw new AppError("Contenuto della raccolta non trovato", 404);
    const item = await ItemV2.findOne({ _id: membership.itemId, lifecycleStatus: "active" }).select("primarySubjectId").session(session).lean();
    if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE" }]);
    const remaining = await remainingCollectionItemsForSubject({ context, subjectId: item.primarySubjectId, excludingEntryId: membership._id, session });
    const isLastRepresentation = remaining.length === 0;
    const projected = isLastRepresentation ? graphSnapshotWithoutSubject(sourceGraph, item.primarySubjectId) : null;

    if (projected?.contained && !cascadeGraph) {
      throw new AppError("Questo è l'ultimo contenuto della Raccolta che rappresenta un Subject usato nel grafo", 409, [{
        code: "COLLECTION_ITEM_GRAPH_SUBJECT_IN_USE",
        context: {
          subjectId: item.primarySubjectId,
          relationCount: projected.removedRelationCount,
        },
      }]);
    }

    await CollectionItemMembership.deleteOne({ _id: membership._id }, { session });
    await bumpWorkingVersion({ context, session });

    if (projected?.contained && cascadeGraph) {
      if (!semanticGraph || !sourceGraph) throw new AppError("Grafo semantico non disponibile", 409);
      await writeGraphSnapshot({ semanticGraph, sourceGraph, snapshot: projected, actorUserId, session });
      removal = {
        removed: true,
        removedGraphSubject: true,
        removedRelationCount: projected.removedRelationCount,
      };
    }
  });
  return removal;
}

async function itemIdsMatchingQuery(context, q) {
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
  const revisionEditionIds = matchingRevisions.map((entry) => entry.itemEditionId);
  const revisionEditions = revisionEditionIds.length
    ? await ItemEdition.find({ _id: { $in: revisionEditionIds }, namespaceId: context.namespaceId }).select("itemId").limit(1500).lean()
    : [];
  return [...new Set([...subjectItems.map((entry) => id(entry._id)), ...revisionEditions.map((entry) => id(entry.itemId))])];
}

async function listEditorialContextEntries({ editorialContextId, actorUserId, q = "", page = 1, limit = 50 }) {
  const context = await findContextOrFail(editorialContextId);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const matchingItemIds = await itemIdsMatchingQuery(context, q);
  const query = { editorialContextId: context._id };
  if (matchingItemIds) query.itemId = { $in: matchingItemIds };
  const [total, entries] = await Promise.all([
    CollectionItemMembership.countDocuments(query),
    CollectionItemMembership.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const itemIds = entries.map((entry) => entry.itemId);
  const items = itemIds.length ? await ItemV2.find({ _id: { $in: itemIds } }).lean() : [];
  const itemById = new Map(items.map((item) => [id(item), item]));
  const editions = itemIds.length
    ? await ItemEdition.find({ itemId: { $in: itemIds }, namespaceId: context.namespaceId }).lean()
    : [];
  const editionByItemId = new Map(editions.map((edition) => [id(edition.itemId), edition]));
  const revisionIds = [...new Set(editions.map((edition) => id(edition.workingRevisionId || edition.publishedRevisionId)).filter(Boolean))];
  const revisions = revisionIds.length ? await ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label status version").lean() : [];
  const revisionById = new Map(revisions.map((revision) => [id(revision), revision]));
  const subjectIds = [...new Set(items.map((item) => id(item.primarySubjectId)).filter(Boolean))];
  const subjects = subjectIds.length ? await Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description").lean() : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject), subject]));

  return {
    context: { id: context._id, name: context.displayName, workingVersion: context.workingVersion || 0, activeReviewRevisionId: context.activeReviewRevisionId || null },
    results: entries.map((entry) => {
      const item = itemById.get(id(entry.itemId)) || null;
      const edition = item ? editionByItemId.get(id(item._id)) || null : null;
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
  resolveEligibleItem,
  addEditorialContextEntry,
  updateEditorialContextEntry,
  removeEditorialContextEntry,
  listEditorialContextEntries,
};
