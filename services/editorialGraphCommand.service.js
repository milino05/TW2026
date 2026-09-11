const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ItemV2 = require("../models/itemV2.model");
const SemanticGraph = require("../models/semanticGraph.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const { findSemanticGraphResourceOrFail } = require("./semanticGraphResource.service");
const { writeSemanticGraphSnapshot } = require("./semanticGraphSnapshotWriter.service");

function id(value) {
  return String(value?._id || value || "");
}

function sameId(left, right) {
  return id(left) === id(right);
}

function edgeKey(edge) {
  return JSON.stringify([
    id(edge?.sourceSubjectId),
    String(edge?.relationTypeDefinitionId || ""),
    id(edge?.targetSubjectId),
  ]);
}

function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
  }
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
  if (!Array.isArray(value)) {
    throw new AppError("subjectClassAssignments deve essere un array", 400, [{
      field: "subjectClassAssignments",
      code: "INVALID_TYPE",
    }]);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const subjectId = entry?.subjectId;
    assertObjectId(subjectId, `subjectClassAssignments[${index}].subjectId`);
    const key = id(subjectId);
    if (seen.has(key)) {
      throw new AppError("Classificazione duplicata per Subject", 400, [{
        field: `subjectClassAssignments[${index}].subjectId`,
        code: "DUPLICATE",
      }]);
    }
    if (!Array.isArray(entry?.subjectClassDefinitionIds)) {
      throw new AppError("subjectClassDefinitionIds deve essere un array", 400, [{
        field: `subjectClassAssignments[${index}].subjectClassDefinitionIds`,
        code: "INVALID_TYPE",
      }]);
    }
    seen.add(key);
    return {
      subjectId,
      subjectClassDefinitionIds: [...new Set(entry.subjectClassDefinitionIds
        .map((definitionId) => String(definitionId || "").trim())
        .filter(Boolean))],
    };
  });
}

function applyClassAssignments(snapshot, assignments) {
  for (const assignment of assignments) {
    const binding = ensureBinding(snapshot, assignment.subjectId);
    binding.subjectClassDefinitionIds = assignment.subjectClassDefinitionIds;
  }
}

function relationDefinition(namespaceRevision, relationTypeDefinitionId) {
  return (namespaceRevision?.relationTypes || []).find((entry) => (
    String(entry.definitionId) === String(relationTypeDefinitionId)
  )) || null;
}

function sameRelationEdge(edge, sourceSubjectId, targetSubjectId, relationTypeDefinitionId, relation) {
  if (String(edge.relationTypeDefinitionId) !== String(relationTypeDefinitionId)) return false;
  const direct = sameId(edge.sourceSubjectId, sourceSubjectId) && sameId(edge.targetSubjectId, targetSubjectId);
  if (direct) return true;
  return relation?.directionality === "symmetric"
    && sameId(edge.sourceSubjectId, targetSubjectId)
    && sameId(edge.targetSubjectId, sourceSubjectId);
}

async function collectionSubjectIds(context) {
  const memberships = await CollectionItemMembership.find({ editorialContextId: context._id })
    .select("itemId")
    .lean();
  if (!memberships.length) return new Set();
  const items = await ItemV2.find({
    _id: { $in: memberships.map((entry) => entry.itemId) },
    lifecycleStatus: "active",
  }).select("primarySubjectId").lean();
  return new Set(items.map((entry) => id(entry.primarySubjectId)).filter(Boolean));
}

async function collectionContainmentIssues(context, snapshot) {
  if (!context) return [];
  const allowed = await collectionSubjectIds(context);
  return (snapshot.subjectBindings || [])
    .filter((binding) => !allowed.has(id(binding.subjectId)))
    .map((binding) => ({
      field: "subjectId",
      code: "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT",
      message: "Il Subject del grafo deve essere rappresentato da almeno un contenuto della Raccolta",
      context: { subjectId: binding.subjectId },
    }));
}

async function assertCollectionSubjectsAvailable(context, subjectIds) {
  if (!context) return;
  const allowed = await collectionSubjectIds(context);
  const missing = [...new Set(subjectIds.map(id).filter(Boolean))]
    .filter((subjectId) => !allowed.has(subjectId));
  if (!missing.length) return;
  throw new AppError(
    "Aggiungi prima alla Raccolta i contenuti che rappresentano i Subject selezionati",
    409,
    missing.map((subjectId) => ({
      field: "subjectId",
      code: "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT",
      context: { subjectId },
    })),
  );
}

async function loadGraphAuthoringState({ semanticGraphId, actorUserId, allowCollectionBound = false }) {
  const semanticGraph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId, write: true });
  if (!allowCollectionBound) {
    const boundContext = await EditorialContext.findOne({ semanticGraphId: semanticGraph._id })
      .select("_id lifecycleStatus")
      .lean();
    if (boundContext) {
      throw new AppError("Il grafo locale di una Raccolta si modifica dal contesto della Raccolta", 409, [{
        code: "SEMANTIC_GRAPH_COLLECTION_BOUND_USE_CONTEXT_API",
        context: {
          editorialContextId: boundContext._id,
          editorialContextLifecycleStatus: boundContext.lifecycleStatus,
        },
      }]);
    }
  }

  const namespace = await Namespace.findOne({ _id: semanticGraph.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 409);
  await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: semanticGraph.ownerType,
    principalId: semanticGraph.ownerId,
  });

  const graph = semanticGraph.workingRevisionId
    ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId)
    : null;
  const namespaceRevisionId = graph?.revision?.authoredAgainstNamespaceRevisionId
    || namespace.workingRevisionId
    || namespace.publishedRevisionId;
  if (!namespaceRevisionId) throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409);
  const namespaceRevision = await NamespaceRevision.findOne({
    _id: namespaceRevisionId,
    namespaceId: namespace._id,
  }).lean();
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
    throw new AppError("Il grafo semantico appartiene a un'altra area di lavoro", 409, [{
      code: "SEMANTIC_GRAPH_OWNER_MISMATCH",
    }]);
  }
  if (!sameId(semanticGraph.namespaceId, context.namespaceId)) {
    throw new AppError("Il grafo semantico usa regole editoriali diverse dalla raccolta", 409, [{
      code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH",
    }]);
  }

  const state = await loadGraphAuthoringState({
    semanticGraphId: semanticGraph._id,
    actorUserId,
    allowCollectionBound: true,
  });
  return { context, contentSpace, ...state };
}

async function loadAuthoringTarget({ semanticGraphId = null, editorialContextId = null, actorUserId }) {
  if (Boolean(semanticGraphId) === Boolean(editorialContextId)) {
    throw new AppError("Indicare esattamente un grafo o una raccolta", 400, [{
      code: "SEMANTIC_GRAPH_AUTHORING_TARGET_REQUIRED",
    }]);
  }
  return editorialContextId
    ? loadAuthoringContext({ editorialContextId, actorUserId })
    : loadGraphAuthoringState({ semanticGraphId, actorUserId });
}

async function commitSnapshot({
  semanticGraph,
  namespaceRevision,
  snapshot,
  actorUserId,
  context = null,
  afterPersist = null,
}) {
  const issues = await collectionContainmentIssues(context, snapshot);
  if (issues.length) throw new AppError("Il grafo non rispetta i contenuti della Raccolta", 409, issues);

  const revision = await writeSemanticGraphSnapshot({
    semanticGraph,
    namespaceRevision,
    snapshot,
    actorUserId,
    afterPersist,
  });
  return loadSemanticGraphRevision(revision._id, { bypassCache: true });
}

function normalizeWeight(value) {
  const weight = value === undefined ? 1 : Number(value);
  if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
    throw new AppError("Peso della relazione non valido", 400, [{
      field: "weight",
      code: "OUT_OF_RANGE",
    }]);
  }
  return weight;
}

function suppressEdgeAfterPersist(context, edge) {
  if (!context) return null;
  const suppressedKey = edgeKey(edge);
  return ({ session }) => EditorialGraphImportSource.updateMany(
    { editorialContextId: context._id },
    { $addToSet: { suppressedEdgeKeys: suppressedKey } },
    { session },
  );
}

function humanEditedProvenance(edge, context) {
  if (!context) return edge.provenance ?? { origin: "human" };
  const sourceGraphRevisionId = edge.provenance?.sourceGraphRevisionId || null;
  return {
    origin: "human",
    metadata: sourceGraphRevisionId ? {
      editedFromImportedEdge: true,
      sourceGraphRevisionId,
    } : null,
  };
}

async function addGraphSubject({ semanticGraphId = null, editorialContextId = null, subjectId, actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  await assertCollectionSubjectsAvailable(state.context, [subjectId]);
  if (state.snapshot.subjectBindings.some((binding) => sameId(binding.subjectId, subjectId))) return state.graph;
  ensureBinding(state.snapshot, subjectId);
  return commitSnapshot({ ...state, actorUserId });
}

async function removeGraphSubject({ semanticGraphId = null, editorialContextId = null, subjectId, actorUserId }) {
  assertObjectId(subjectId, "subjectId");
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  if (state.snapshot.edges.some((edge) => (
    sameId(edge.sourceSubjectId, subjectId) || sameId(edge.targetSubjectId, subjectId)
  ))) {
    throw new AppError("Rimuovi prima le relazioni che usano questo Subject", 409, [{
      code: "SEMANTIC_GRAPH_SUBJECT_IN_USE",
      context: { subjectId },
    }]);
  }
  const before = state.snapshot.subjectBindings.length;
  state.snapshot.subjectBindings = state.snapshot.subjectBindings
    .filter((binding) => !sameId(binding.subjectId, subjectId));
  if (state.snapshot.subjectBindings.length === before) return state.graph;
  return commitSnapshot({ ...state, actorUserId });
}

async function addGraphEdge({ semanticGraphId = null, editorialContextId = null, payload, actorUserId }) {
  const sourceSubjectId = payload?.sourceSubjectId;
  const targetSubjectId = payload?.targetSubjectId;
  const relationTypeDefinitionId = String(payload?.relationTypeDefinitionId || "").trim();
  assertObjectId(sourceSubjectId, "sourceSubjectId");
  assertObjectId(targetSubjectId, "targetSubjectId");
  if (!relationTypeDefinitionId) {
    throw new AppError("Tipo di relazione obbligatorio", 400, [{ field: "relationTypeDefinitionId", code: "REQUIRED" }]);
  }
  if (sameId(sourceSubjectId, targetSubjectId)) {
    throw new AppError("Una relazione deve collegare due Subject distinti", 400, [{ code: "SELF_RELATION_NOT_ALLOWED" }]);
  }

  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  await assertCollectionSubjectsAvailable(state.context, [sourceSubjectId, targetSubjectId]);
  const relation = relationDefinition(state.namespaceRevision, relationTypeDefinitionId);
  if (state.snapshot.edges.some((edge) => sameRelationEdge(edge, sourceSubjectId, targetSubjectId, relationTypeDefinitionId, relation))) {
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

  const sourceSubjectId = payload?.sourceSubjectId === undefined ? edge.sourceSubjectId : payload.sourceSubjectId;
  const targetSubjectId = payload?.targetSubjectId === undefined ? edge.targetSubjectId : payload.targetSubjectId;
  assertObjectId(sourceSubjectId, "sourceSubjectId");
  assertObjectId(targetSubjectId, "targetSubjectId");
  if (sameId(sourceSubjectId, targetSubjectId)) {
    throw new AppError("Una relazione deve collegare due Subject distinti", 400, [{ code: "SELF_RELATION_NOT_ALLOWED" }]);
  }
  await assertCollectionSubjectsAvailable(state.context, [sourceSubjectId, targetSubjectId]);

  const relationTypeDefinitionId = payload?.relationTypeDefinitionId === undefined
    ? String(edge.relationTypeDefinitionId)
    : String(payload.relationTypeDefinitionId || "").trim();
  if (!relationTypeDefinitionId) {
    throw new AppError("Tipo di relazione obbligatorio", 400, [{ field: "relationTypeDefinitionId", code: "REQUIRED" }]);
  }

  state.snapshot.edges = state.snapshot.edges.filter((entry) => !(
    sameId(entry.sourceSubjectId, edge.sourceSubjectId)
    && sameId(entry.targetSubjectId, edge.targetSubjectId)
    && String(entry.relationTypeDefinitionId) === String(edge.relationTypeDefinitionId)
  ));
  const relation = relationDefinition(state.namespaceRevision, relationTypeDefinitionId);
  if (state.snapshot.edges.some((entry) => sameRelationEdge(entry, sourceSubjectId, targetSubjectId, relationTypeDefinitionId, relation))) {
    throw new AppError("Questa relazione esiste già", 409, [{ code: "SEMANTIC_EDGE_EXISTS" }]);
  }

  ensureBinding(state.snapshot, sourceSubjectId);
  ensureBinding(state.snapshot, targetSubjectId);
  applyClassAssignments(state.snapshot, normalizeClassAssignments(payload?.subjectClassAssignments));
  state.snapshot.edges.push({
    sourceSubjectId,
    targetSubjectId,
    relationTypeDefinitionId,
    weight: payload?.weight === undefined ? normalizeWeight(edge.weight) : normalizeWeight(payload.weight),
    metadata: payload?.metadata === undefined ? (edge.metadata ?? null) : (payload.metadata ?? null),
    provenance: humanEditedProvenance(edge, state.context),
  });

  return commitSnapshot({
    ...state,
    actorUserId,
    afterPersist: suppressEdgeAfterPersist(state.context, edge),
  });
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

  return commitSnapshot({
    ...state,
    actorUserId,
    afterPersist: suppressEdgeAfterPersist(state.context, edge),
  });
}

async function setGraphSubjectClasses({
  semanticGraphId = null,
  editorialContextId = null,
  subjectId,
  subjectClassDefinitionIds = [],
  actorUserId,
}) {
  assertObjectId(subjectId, "subjectId");
  if (!Array.isArray(subjectClassDefinitionIds)) {
    throw new AppError("subjectClassDefinitionIds deve essere un array", 400);
  }
  const definitions = [...new Set(subjectClassDefinitionIds
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  const state = await loadAuthoringTarget({ semanticGraphId, editorialContextId, actorUserId });
  await assertCollectionSubjectsAvailable(state.context, [subjectId]);
  let binding = state.snapshot.subjectBindings.find((entry) => sameId(entry.subjectId, subjectId));
  if (!binding) {
    if (!definitions.length) return state.graph;
    binding = ensureBinding(state.snapshot, subjectId);
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

function setEditorialGraphSubjectClasses({
  editorialContextId,
  subjectId,
  subjectClassDefinitionIds,
  actorUserId,
}) {
  return setGraphSubjectClasses({ editorialContextId, subjectId, subjectClassDefinitionIds, actorUserId });
}

module.exports = {
  loadGraphAuthoringState,
  loadAuthoringContext,
  collectionContainmentIssues,
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
