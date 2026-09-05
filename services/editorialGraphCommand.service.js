const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraph = require("../models/semanticGraph.model");
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
const { findSemanticGraphResourceOrFail } = require("./semanticGraphResource.service");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function workingConflict() {
  return new AppError("Il grafo semantico è stato modificato da un'altra operazione", 409, [{ code: "SEMANTIC_GRAPH_WORKING_CONFLICT" }]);
}
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
function ensureBinding(snapshot, subjectId) {
  const existing = snapshot.subjectBindings.find((binding) => sameId(binding.subjectId, subjectId));
  if (existing) return existing;
  const binding = { subjectId, subjectClassDefinitionIds: [] };
  snapshot.subjectBindings.push(binding);
  return binding;
}
function normalizeClassAssignments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError("subjectClassAssignments deve essere un array", 400, [{ field: "subjectClassAssignments", code: "INVALID_TYPE" }]);
  const seen = new Set();
  return value.map((entry, index) => {
    const subjectId = entry?.subjectId;
    assertObjectId(subjectId, `subjectClassAssignments[${index}].subjectId`);
    const key = id(subjectId);
    if (seen.has(key)) throw new AppError("Classificazione duplicata per Subject", 400, [{ field: `subjectClassAssignments[${index}].subjectId`, code: "DUPLICATE" }]);
    if (!Array.isArray(entry?.subjectClassDefinitionIds)) throw new AppError("subjectClassDefinitionIds deve essere un array", 400, [{ field: `subjectClassAssignments[${index}].subjectClassDefinitionIds`, code: "INVALID_TYPE" }]);
    seen.add(key);
    return {
      subjectId,
      subjectClassDefinitionIds: [...new Set(entry.subjectClassDefinitionIds.map((definitionId) => String(definitionId || "").trim()).filter(Boolean))],
    };
  });
}
function applyClassAssignments(snapshot, assignments) {
  for (const assignment of assignments) {
    const binding = ensureBinding(snapshot, assignment.subjectId);
    binding.subjectClassDefinitionIds = assignment.subjectClassDefinitionIds;
  }
}

async function loadGraphAuthoringState({ semanticGraphId, actorUserId }) {
  const semanticGraph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId, write: true });
  const namespace = await Namespace.findOne({ _id: semanticGraph.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 409);
  await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: semanticGraph.ownerType,
    principalId: semanticGraph.ownerId,
  });
  const graph = semanticGraph.workingRevisionId ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId) : null;
  const namespaceRevisionId = graph?.revision?.authoredAgainstNamespaceRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!namespaceRevisionId) throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409);
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: namespace._id }).lean();
  if (!namespaceRevision) throw new AppError("Revisione delle regole editoriali non disponibile", 409);
  return {
    semanticGraph,
    namespace,
    namespaceRevision,
    graph,
    snapshot: cloneSnapshot(graph),
  };
}

async function loadAuthoringContext({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "semantic_graph.edit");
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" });
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 409);
  if (semanticGraph.ownerType !== contentSpace.ownerType || !sameId(semanticGraph.ownerId, contentSpace.ownerId)) {
    throw new AppError("Il grafo semantico appartiene a un'altra area di lavoro", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
  }
  if (!sameId(semanticGraph.namespaceId, context.namespaceId)) {
    throw new AppError("Il grafo semantico usa regole editoriali diverse dalla raccolta", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
  }
  const state = await loadGraphAuthoringState({ semanticGraphId: semanticGraph._id, actorUserId });
  return { context, contentSpace, ...state };
}

async function loadAuthoringTarget({ semanticGraphId = null, editorialContextId = null, actorUserId }) {
  if (Boolean(semanticGraphId) === Boolean(editorialContextId)) {
    throw new AppError("Indicare esattamente un grafo o una raccolta", 400, [{ code: "SEMANTIC_GRAPH_AUTHORING_TARGET_REQUIRED" }]);
  }
  return editorialContextId
    ? loadAuthoringContext({ editorialContextId, actorUserId })
    : loadGraphAuthoringState({ semanticGraphId, actorUserId });
}

async function validateSubjects(snapshot) {
  const values = [...new Set((snapshot.subjectBindings || []).map((entry) => id(entry.subjectId)).filter(Boolean))];
  if (!values.length) return [];
  const found = await Subject.find({ _id: { $in: values } }).select("_id").lean();
  const foundIds = new Set(found.map((entry) => id(entry)));
  return values.filter((value) => !foundIds.has(value)).map((value) => ({ field: "subjectId", code: "SUBJECT_NOT_FOUND", message: `Subject non trovato: ${value}` }));
}

async function nextVersion(semanticGraphId, session) {
  const latest = await SemanticGraphRevision.findOne({ semanticGraphId }).sort({ version: -1 }).select("version").session(session).lean();
  return (latest?.version || 0) + 1;
}

async function commitSnapshot({ semanticGraph, namespaceRevision, snapshot, actorUserId }) {
  const issues = [
    ...await validateSubjects(snapshot),
    ...validateGraphSnapshotAgainstNamespace(snapshot, namespaceRevision),
  ];
  if (issues.length) throw new AppError("Il grafo non rispetta le regole editoriali", 409, issues);
  const expectedWorkingVersion = Number(semanticGraph.workingVersion || 0);
  const expectedGraphRevisionId = semanticGraph.workingRevisionId || null;
  let revision = null;
  await mongoose.connection.transaction(async (session) => {
    const locked = await SemanticGraph.findOne({
      _id: semanticGraph._id,
      lifecycleStatus: "active",
      workingVersion: expectedWorkingVersion,
      workingRevisionId: expectedGraphRevisionId,
    }).session(session);
    if (!locked) throw workingConflict();
    [revision] = await SemanticGraphRevision.create([{
      semanticGraphId: locked._id,
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
    locked.workingRevisionId = revision._id;
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

async function addGraphSubject({ semanticGraphId = null, editorialContextId = null, subjectId, actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  if (state.snapshot.subjectBindings.some((binding) => sameId(binding.subjectId, subjectId))) return state.graph;
  ensureBinding(state.snapshot, subjectId);
  return commitSnapshot({ ...state, actorUserId });
}

async function removeGraphSubject({ semanticGraphId = null, editorialContextId = null, subjectId, actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  if (state.snapshot.edges.some((edge) => sameId(edge.sourceSubjectId, subjectId) || sameId(edge.targetSubjectId, subjectId))) {
    throw new AppError("Rimuovi prima le relazioni che usano questo Subject", 409, [{ code: "SEMANTIC_GRAPH_SUBJECT_IN_USE", context: { subjectId } }]);
  }
  const before = state.snapshot.subjectBindings.length;
  state.snapshot.subjectBindings = state.snapshot.subjectBindings.filter((binding) => !sameId(binding.subjectId, subjectId));
  if (state.snapshot.subjectBindings.length === before) return state.graph;
  return commitSnapshot({ ...state, actorUserId });
}

async function addGraphEdge({ semanticGraphId = null, editorialContextId = null, payload, actorUserId }) {
  const sourceSubjectId = payload?.sourceSubjectId;
  const targetSubjectId = payload?.targetSubjectId;
  const relationTypeDefinitionId = String(payload?.relationTypeDefinitionId || "").trim();
  assertObjectId(sourceSubjectId, "sourceSubjectId");
  assertObjectId(targetSubjectId, "targetSubjectId");
  if (!relationTypeDefinitionId) throw new AppError("Tipo di relazione obbligatorio", 400, [{ field: "relationTypeDefinitionId", code: "REQUIRED" }]);
  if (sameId(sourceSubjectId, targetSubjectId)) throw new AppError("Una relazione deve collegare due Subject distinti", 400, [{ code: "SELF_RELATION_NOT_ALLOWED" }]);
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  if (state.snapshot.edges.some((edge) => sameId(edge.sourceSubjectId, sourceSubjectId) && sameId(edge.targetSubjectId, targetSubjectId) && String(edge.relationTypeDefinitionId) === relationTypeDefinitionId)) {
    throw new AppError("Questa relazione esiste già", 409, [{ code: "SEMANTIC_EDGE_EXISTS" }]);
  }
  ensureBinding(state.snapshot, sourceSubjectId);
  ensureBinding(state.snapshot, targetSubjectId);
  applyClassAssignments(state.snapshot, normalizeClassAssignments(payload?.subjectClassAssignments));
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

async function updateGraphEdge({ semanticGraphId = null, editorialContextId = null, edgeId, payload, actorUserId }) {
  assertObjectId(edgeId, "edgeId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  const edge = state.graph?.authoritativeEdges.find((entry) => sameId(entry._id, edgeId));
  if (!edge) throw new AppError("Relazione non trovata", 404);
  const relationTypeDefinitionId = payload?.relationTypeDefinitionId === undefined
    ? String(edge.relationTypeDefinitionId)
    : String(payload.relationTypeDefinitionId || "").trim();
  if (!relationTypeDefinitionId) throw new AppError("Tipo di relazione obbligatorio", 400, [{ field: "relationTypeDefinitionId", code: "REQUIRED" }]);
  state.snapshot.edges = state.snapshot.edges.filter((entry) => !(
    sameId(entry.sourceSubjectId, edge.sourceSubjectId)
    && sameId(entry.targetSubjectId, edge.targetSubjectId)
    && String(entry.relationTypeDefinitionId) === String(edge.relationTypeDefinitionId)
  ));
  if (state.snapshot.edges.some((entry) => sameId(entry.sourceSubjectId, edge.sourceSubjectId) && sameId(entry.targetSubjectId, edge.targetSubjectId) && String(entry.relationTypeDefinitionId) === relationTypeDefinitionId)) {
    throw new AppError("Questa relazione esiste già", 409, [{ code: "SEMANTIC_EDGE_EXISTS" }]);
  }
  ensureBinding(state.snapshot, edge.sourceSubjectId);
  ensureBinding(state.snapshot, edge.targetSubjectId);
  applyClassAssignments(state.snapshot, normalizeClassAssignments(payload?.subjectClassAssignments));
  state.snapshot.edges.push({
    sourceSubjectId: edge.sourceSubjectId,
    targetSubjectId: edge.targetSubjectId,
    relationTypeDefinitionId,
    weight: payload?.weight === undefined ? normalizeWeight(edge.weight) : normalizeWeight(payload.weight),
    metadata: payload?.metadata === undefined ? (edge.metadata ?? null) : (payload.metadata ?? null),
    provenance: edge.provenance ?? { origin: "human" },
  });
  return commitSnapshot({ ...state, actorUserId });
}

async function removeGraphEdge({ semanticGraphId = null, editorialContextId = null, edgeId, actorUserId }) {
  assertObjectId(edgeId, "edgeId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  const edge = state.graph?.authoritativeEdges.find((entry) => sameId(entry._id, edgeId));
  if (!edge) throw new AppError("Relazione non trovata", 404);
  state.snapshot.edges = state.snapshot.edges.filter((entry) => !(
    sameId(entry.sourceSubjectId, edge.sourceSubjectId)
    && sameId(entry.targetSubjectId, edge.targetSubjectId)
    && String(entry.relationTypeDefinitionId) === String(edge.relationTypeDefinitionId)
  ));
  return commitSnapshot({ ...state, actorUserId });
}

async function setGraphSubjectClasses({ semanticGraphId = null, editorialContextId = null, subjectId, subjectClassDefinitionIds = [], actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  if (!Array.isArray(subjectClassDefinitionIds)) throw new AppError("subjectClassDefinitionIds deve essere un array", 400);
  const definitions = [...new Set(subjectClassDefinitionIds.map((value) => String(value || "").trim()).filter(Boolean))];
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  const binding = state.snapshot.subjectBindings.find((entry) => sameId(entry.subjectId, subjectId));
  if (!binding) {
    throw new AppError("Aggiungi prima il Subject al grafo semantico", 409, [{
      field: "subjectId",
      code: "SEMANTIC_GRAPH_SUBJECT_NOT_BOUND",
      context: { subjectId },
    }]);
  }
  binding.subjectClassDefinitionIds = definitions;
  return commitSnapshot({ ...state, actorUserId });
}

function addEditorialGraphSubject({ editorialContextId, subjectId, actorUserId }) {
  return addGraphSubject({ editorialContextId, subjectId, actorUserId });
}
function removeEditorialGraphSubject({ editorialContextId, subjectId, actorUserId }) {
  return removeGraphSubject({ editorialContextId, subjectId, actorUserId });
}
function addEditorialGraphEdge({ editorialContextId, payload, actorUserId }) {
  return addGraphEdge({ editorialContextId, payload, actorUserId });
}
function updateEditorialGraphEdge({ editorialContextId, edgeId, payload, actorUserId }) {
  return updateGraphEdge({ editorialContextId, edgeId, payload, actorUserId });
}
function removeEditorialGraphEdge({ editorialContextId, edgeId, actorUserId }) {
  return removeGraphEdge({ editorialContextId, edgeId, actorUserId });
}
function setEditorialGraphSubjectClasses({ editorialContextId, subjectId, subjectClassDefinitionIds, actorUserId }) {
  return setGraphSubjectClasses({ editorialContextId, subjectId, subjectClassDefinitionIds, actorUserId });
}

module.exports = {
  loadGraphAuthoringState,
  loadAuthoringContext,
  addGraphSubject,
  removeGraphSubject,
  addGraphEdge,
  updateGraphEdge,
  removeGraphEdge,
  setGraphSubjectClasses,
  addEditorialGraphSubject,
  removeEditorialGraphSubject,
  addEditorialGraphEdge,
  updateEditorialGraphEdge,
  removeEditorialGraphEdge,
  setEditorialGraphSubjectClasses,
};
