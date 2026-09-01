const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { loadSemanticGraphRevision, validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function workingConflict() { return new AppError("Il grafo della raccolta è stato modificato da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}
function cloneSnapshot(graph) {
  if (!graph) return { basedOnRevisionId: null, subjectBindings: [], edges: [] };
  return {
    basedOnRevisionId: graph.revision._id,
    subjectBindings: [...graph.nodes.values()]
      .filter((node) => node.binding)
      .map((node) => ({
        subjectId: node.subject._id,
        subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
      })),
    edges: graph.authoritativeEdges.map((edge) => ({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance ?? { origin: "human" },
    })),
  };
}

async function loadAuthoringContext({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "semantic_graph.edit");
  if (context.activeReviewRevisionId) throw new AppError("Il grafo è bloccato mentre la raccolta è in revisione", 409, [{ code: "EDITORIAL_CONTEXT_REVIEW_LOCKED" }]);
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 409);
  await assertCanUseNamespaceForAuthoring({ namespace, actorUserId, principalType: contentSpace.ownerType, principalId: contentSpace.ownerId });
  const graph = context.workingGraphRevisionId ? await loadSemanticGraphRevision(context.workingGraphRevisionId) : null;
  const namespaceRevisionId = graph?.revision?.authoredAgainstNamespaceRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!namespaceRevisionId) throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409);
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: namespace._id }).lean();
  if (!namespaceRevision) throw new AppError("Revisione delle regole editoriali non disponibile", 409);
  return { context, contentSpace, namespace, namespaceRevision, graph, snapshot: cloneSnapshot(graph) };
}

async function validateSubjects(snapshot) {
  const values = [...new Set([
    ...(snapshot.subjectBindings || []).map((entry) => id(entry.subjectId)),
    ...(snapshot.edges || []).flatMap((edge) => [id(edge.sourceSubjectId), id(edge.targetSubjectId)]),
  ].filter(Boolean))];
  if (!values.length) return [];
  const found = await Subject.find({ _id: { $in: values } }).select("_id").lean();
  const foundIds = new Set(found.map((entry) => id(entry)));
  return values.filter((value) => !foundIds.has(value)).map((value) => ({ field: "subjectId", code: "SUBJECT_NOT_FOUND", message: `Subject non trovato: ${value}` }));
}

async function nextVersion(editorialContextId, session) {
  const latest = await SemanticGraphRevision.findOne({ editorialContextId }).sort({ version: -1 }).select("version").session(session).lean();
  return (latest?.version || 0) + 1;
}

async function commitSnapshot({ context, namespaceRevision, snapshot, actorUserId }) {
  const issues = [
    ...await validateSubjects(snapshot),
    ...validateGraphSnapshotAgainstNamespace(snapshot, namespaceRevision),
  ];
  if (issues.length) throw new AppError("Il grafo non rispetta le regole editoriali", 409, issues);
  const expectedWorkingVersion = Number(context.workingVersion || 0);
  const expectedGraphRevisionId = context.workingGraphRevisionId || null;
  let revision = null;
  await mongoose.connection.transaction(async (session) => {
    const locked = await EditorialContext.findOne({
      _id: context._id,
      lifecycleStatus: "active",
      activeReviewRevisionId: null,
      workingVersion: expectedWorkingVersion,
      workingGraphRevisionId: expectedGraphRevisionId,
    }).session(session);
    if (!locked) throw workingConflict();
    [revision] = await SemanticGraphRevision.create([{
      editorialContextId: locked._id,
      version: await nextVersion(locked._id, session),
      basedOnRevisionId: expectedGraphRevisionId,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
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
    locked.workingGraphRevisionId = revision._id;
    locked.workingVersion = expectedWorkingVersion + 1;
    await locked.save({ session });
  });
  return loadSemanticGraphRevision(revision._id, { bypassCache: true });
}

function normalizeWeight(value) {
  const weight = value === undefined ? 1 : Number(value);
  if (!Number.isFinite(weight) || weight < 0 || weight > 10) throw new AppError("Peso della relazione non valido", 400, [{ field: "weight", code: "OUT_OF_RANGE" }]);
  return weight;
}

async function addEditorialGraphEdge({ editorialContextId, payload, actorUserId }) {
  const sourceSubjectId = payload?.sourceSubjectId;
  const targetSubjectId = payload?.targetSubjectId;
  const relationTypeDefinitionId = String(payload?.relationTypeDefinitionId || "").trim();
  assertObjectId(sourceSubjectId, "sourceSubjectId");
  assertObjectId(targetSubjectId, "targetSubjectId");
  if (!relationTypeDefinitionId) throw new AppError("Tipo di relazione obbligatorio", 400, [{ field: "relationTypeDefinitionId", code: "REQUIRED" }]);
  if (sameId(sourceSubjectId, targetSubjectId)) throw new AppError("Una relazione deve collegare due Subject distinti", 400, [{ code: "SELF_RELATION_NOT_ALLOWED" }]);
  const state = await loadAuthoringContext({ editorialContextId, actorUserId });
  if (state.snapshot.edges.some((edge) => sameId(edge.sourceSubjectId, sourceSubjectId) && sameId(edge.targetSubjectId, targetSubjectId) && String(edge.relationTypeDefinitionId) === relationTypeDefinitionId)) {
    throw new AppError("Questa relazione esiste già", 409, [{ code: "SEMANTIC_EDGE_EXISTS" }]);
  }
  state.snapshot.edges.push({
    sourceSubjectId,
    targetSubjectId,
    relationTypeDefinitionId,
    weight: normalizeWeight(payload?.weight),
    metadata: payload?.metadata ?? null,
    provenance: { origin: "human" },
  });
  return commitSnapshot({ ...state, actorUserId });
}

async function removeEditorialGraphEdge({ editorialContextId, edgeId, actorUserId }) {
  assertObjectId(edgeId, "edgeId");
  const state = await loadAuthoringContext({ editorialContextId, actorUserId });
  const edge = state.graph?.authoritativeEdges.find((entry) => sameId(entry._id, edgeId));
  if (!edge) throw new AppError("Relazione non trovata", 404);
  state.snapshot.edges = state.snapshot.edges.filter((entry) => !(sameId(entry.sourceSubjectId, edge.sourceSubjectId) && sameId(entry.targetSubjectId, edge.targetSubjectId) && String(entry.relationTypeDefinitionId) === String(edge.relationTypeDefinitionId)));
  return commitSnapshot({ ...state, actorUserId });
}

async function setEditorialGraphSubjectClasses({ editorialContextId, subjectId, subjectClassDefinitionIds = [], actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  if (!Array.isArray(subjectClassDefinitionIds)) throw new AppError("subjectClassDefinitionIds deve essere un array", 400);
  const definitions = [...new Set(subjectClassDefinitionIds.map((value) => String(value || "").trim()).filter(Boolean))];
  const state = await loadAuthoringContext({ editorialContextId, actorUserId });
  const index = state.snapshot.subjectBindings.findIndex((binding) => sameId(binding.subjectId, subjectId));
  if (!definitions.length) {
    if (index >= 0) state.snapshot.subjectBindings.splice(index, 1);
  } else if (index >= 0) {
    state.snapshot.subjectBindings[index] = { subjectId, subjectClassDefinitionIds: definitions };
  } else {
    state.snapshot.subjectBindings.push({ subjectId, subjectClassDefinitionIds: definitions });
  }
  return commitSnapshot({ ...state, actorUserId });
}

module.exports = {
  loadAuthoringContext,
  addEditorialGraphEdge,
  removeEditorialGraphEdge,
  setEditorialGraphSubjectClasses,
};
