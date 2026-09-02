const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialContext = require("../models/editorialContext.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanManageContentSpace, findContentSpaceOrFail } = require("./contentSpace.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const {
  materializeDirectEdge,
  materializeReverseEdge,
  edgeTraversalWeight,
  relationStrength,
  normalizeKey,
} = require("./relationSemanticsV2.service");
const { normalizeGraphRevisionPayload, validateGraphRevisionPayload } = require("./validation/semanticGraphV2.validation");

const MAX_CACHE_ENTRIES = 24;
const graphCache = new Map();
function id(value) { return String(value?._id || value || ""); }
function semanticRefKey(ref) { return `${normalizeKey(ref?.scheme)}::${String(ref?.id || ref?.refId || "").trim()}`; }
function touchCache(key, value) { graphCache.delete(key); graphCache.set(key, value); while (graphCache.size > MAX_CACHE_ENTRIES) graphCache.delete(graphCache.keys().next().value); }
function graphRevisionConflict() {
  return new AppError("Il grafo è stato modificato da un’altra operazione", 409, [{ code: "GRAPH_REVISION_CONFLICT" }]);
}

async function findContextOrFail(editorialContextId) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("EditorialContext non trovato", 404);
  return context;
}

async function findSemanticGraphOrFail(context) {
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" });
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 409);
  if (id(semanticGraph.namespaceId) !== id(context.namespaceId)) {
    throw new AppError("Il grafo semantico usa un Namespace diverso dal Context", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
  }
  return semanticGraph;
}

async function resolveNamespaceRevision(context, requestedRevisionId = null) {
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace del Context non disponibile", 409);
  const revisionId = requestedRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!revisionId) throw new AppError("Il Namespace non ha una revisione disponibile", 409);
  const revision = await NamespaceRevision.findOne({ _id: revisionId, namespaceId: namespace._id });
  if (!revision) throw new AppError("NamespaceRevision non trovata", 404);
  return { namespace, namespaceRevision: revision };
}

function ensureEdgeBindings(snapshot) {
  const bySubject = new Map((snapshot.subjectBindings || []).map((binding) => [id(binding.subjectId), binding]));
  for (const edge of snapshot.edges || []) {
    for (const subjectId of [edge.sourceSubjectId, edge.targetSubjectId]) {
      const key = id(subjectId);
      if (!key || bySubject.has(key)) continue;
      const binding = { subjectId, subjectClassDefinitionIds: [] };
      snapshot.subjectBindings.push(binding);
      bySubject.set(key, binding);
    }
  }
  return snapshot;
}

function validateGraphSnapshotAgainstNamespace({ subjectBindings = [], edges = [] }, namespaceRevision) {
  const issues = [];
  const classIds = new Set((namespaceRevision.subjectClasses || []).map((entry) => String(entry.definitionId)));
  const relationById = new Map((namespaceRevision.relationTypes || []).map((entry) => [String(entry.definitionId), entry]));
  const classesBySubject = new Map(subjectBindings.map((binding) => [String(binding.subjectId), new Set(binding.subjectClassDefinitionIds || [])]));
  const boundSubjectIds = new Set(subjectBindings.map((binding) => String(binding.subjectId)));

  subjectBindings.forEach((binding, index) => {
    (binding.subjectClassDefinitionIds || []).forEach((definitionId, classIndex) => {
      if (!classIds.has(String(definitionId))) issues.push({ field: `subjectBindings[${index}].subjectClassDefinitionIds[${classIndex}]`, code: "UNKNOWN_SUBJECT_CLASS", message: `SubjectClass non disponibile: ${definitionId}` });
    });
  });

  edges.forEach((edge, index) => {
    if (!boundSubjectIds.has(String(edge.sourceSubjectId))) issues.push({ field: `edges[${index}].sourceSubjectId`, code: "GRAPH_SUBJECT_BINDING_REQUIRED", message: "Il Subject sorgente deve appartenere al grafo" });
    if (!boundSubjectIds.has(String(edge.targetSubjectId))) issues.push({ field: `edges[${index}].targetSubjectId`, code: "GRAPH_SUBJECT_BINDING_REQUIRED", message: "Il Subject destinazione deve appartenere al grafo" });
    const relation = relationById.get(String(edge.relationTypeDefinitionId));
    if (!relation) {
      issues.push({ field: `edges[${index}].relationTypeDefinitionId`, code: "UNKNOWN_RELATION_TYPE", message: `RelationType non disponibile: ${edge.relationTypeDefinitionId}` });
      return;
    }
    const sourceClasses = classesBySubject.get(String(edge.sourceSubjectId)) || new Set();
    const targetClasses = classesBySubject.get(String(edge.targetSubjectId)) || new Set();
    const domain = relation.domainDefinitionIds || [];
    const range = relation.rangeDefinitionIds || [];
    if (domain.length && !domain.some((definitionId) => sourceClasses.has(String(definitionId)))) {
      issues.push({ field: `edges[${index}].sourceSubjectId`, code: "RELATION_DOMAIN_MISMATCH", message: `Il Subject sorgente non soddisfa il domain di ${relation.key}` });
    }
    if (range.length && !range.some((definitionId) => targetClasses.has(String(definitionId)))) {
      issues.push({ field: `edges[${index}].targetSubjectId`, code: "RELATION_RANGE_MISMATCH", message: `Il Subject destinazione non soddisfa il range di ${relation.key}` });
    }
  });
  return issues;
}

async function validateSubjectsExist({ subjectBindings = [] }) {
  const values = [...new Set(subjectBindings.map((binding) => String(binding.subjectId)).filter(Boolean))];
  if (!values.length) return [];
  const found = await Subject.find({ _id: { $in: values } }).select("_id").lean();
  const foundIds = new Set(found.map((entry) => String(entry._id)));
  return values.filter((subjectId) => !foundIds.has(subjectId)).map((subjectId) => ({ field: "subjectId", code: "SUBJECT_NOT_FOUND", message: `Subject non trovato: ${subjectId}` }));
}

async function nextVersion(semanticGraphId) {
  const latest = await SemanticGraphRevision.findOne({ semanticGraphId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function createGraphRevision({ editorialContextId, payload, actorUserId }) {
  const rawPayload = payload || {};
  const shapeIssues = validateGraphRevisionPayload(rawPayload);
  if (shapeIssues.length) throw new AppError("Payload GraphRevision non valido", 400, shapeIssues);
  const normalized = ensureEdgeBindings(normalizeGraphRevisionPayload(rawPayload));
  const context = await findContextOrFail(editorialContextId);
  const semanticGraph = await findSemanticGraphOrFail(context);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "semantic_graph.edit");
  if (semanticGraph.ownerType !== contentSpace.ownerType || id(semanticGraph.ownerId) !== id(contentSpace.ownerId)) {
    throw new AppError("Il grafo semantico appartiene a un'altra area di lavoro", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
  }
  const { namespace, namespaceRevision } = await resolveNamespaceRevision(context, normalized.authoredAgainstNamespaceRevisionId);
  await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });

  if (normalized.basedOnRevisionId) {
    const base = await SemanticGraphRevision.findOne({ _id: normalized.basedOnRevisionId, semanticGraphId: semanticGraph._id });
    if (!base) throw new AppError("GraphRevision base non appartiene al grafo semantico", 409);
  }

  const semanticIssues = [
    ...await validateSubjectsExist(normalized),
    ...validateGraphSnapshotAgainstNamespace(normalized, namespaceRevision),
  ];
  if (semanticIssues.length) throw new AppError("GraphRevision non coerente", 409, semanticIssues);

  const expectedWorkingGraphRevisionId = semanticGraph.workingRevisionId || null;
  const expectedWorkingVersion = Number(semanticGraph.workingVersion || 0);
  if (normalized.basedOnRevisionId && expectedWorkingGraphRevisionId
    && id(normalized.basedOnRevisionId) !== id(expectedWorkingGraphRevisionId)) {
    throw graphRevisionConflict();
  }
  let graphRevision = null;
  try {
    graphRevision = await SemanticGraphRevision.create({
      semanticGraphId: semanticGraph._id,
      version: await nextVersion(semanticGraph._id),
      basedOnRevisionId: normalized.basedOnRevisionId || expectedWorkingGraphRevisionId,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      createdBy: actorUserId,
    });
    if (normalized.subjectBindings.length) {
      await GraphSubjectBinding.insertMany(normalized.subjectBindings.map((binding) => ({
        graphRevisionId: graphRevision._id,
        subjectId: binding.subjectId,
        subjectClassDefinitionIds: binding.subjectClassDefinitionIds || [],
      })), { ordered: true });
    }
    if (normalized.edges.length) {
      await SemanticEdgeV2.insertMany(normalized.edges.map((edge) => ({
        graphRevisionId: graphRevision._id,
        sourceSubjectId: edge.sourceSubjectId,
        targetSubjectId: edge.targetSubjectId,
        relationTypeDefinitionId: edge.relationTypeDefinitionId,
        weight: edge.weight,
        metadata: edge.metadata,
        provenance: edge.provenance,
      })), { ordered: true });
    }
    const pointer = await SemanticGraph.updateOne({
      _id: semanticGraph._id,
      lifecycleStatus: "active",
      workingRevisionId: expectedWorkingGraphRevisionId,
      workingVersion: expectedWorkingVersion,
    }, { $set: { workingRevisionId: graphRevision._id }, $inc: { workingVersion: 1 } });
    if (pointer.modifiedCount !== 1) throw graphRevisionConflict();
  } catch (error) {
    if (graphRevision?._id) {
      await Promise.allSettled([
        GraphSubjectBinding.deleteMany({ graphRevisionId: graphRevision._id }),
        SemanticEdgeV2.deleteMany({ graphRevisionId: graphRevision._id }),
        SemanticGraphRevision.deleteOne({ _id: graphRevision._id }),
      ]);
    }
    if ([11000, 112, 251].includes(Number(error?.code))) throw graphRevisionConflict();
    throw error;
  }
  return loadSemanticGraphRevision(graphRevision._id, { bypassCache: true });
}

async function loadSemanticGraphRevision(graphRevisionId, { namespaceRevisionId = null, bypassCache = false } = {}) {
  const cacheKey = namespaceRevisionId ? `${id(graphRevisionId)}::${id(namespaceRevisionId)}` : id(graphRevisionId);
  if (!bypassCache && graphCache.has(cacheKey)) { const cached = graphCache.get(cacheKey); touchCache(cacheKey, cached); return cached; }
  const revision = await SemanticGraphRevision.findById(graphRevisionId).lean();
  if (!revision) throw new AppError("SemanticGraphRevision non trovata", 404);
  const effectiveNamespaceRevisionId = namespaceRevisionId || revision.authoredAgainstNamespaceRevisionId;
  const [namespaceRevision, bindings, persistedEdges] = await Promise.all([
    NamespaceRevision.findById(effectiveNamespaceRevisionId).lean(),
    GraphSubjectBinding.find({ graphRevisionId: revision._id }).lean(),
    SemanticEdgeV2.find({ graphRevisionId: revision._id }).lean(),
  ]);
  if (!namespaceRevision) throw new AppError("NamespaceRevision del graph non trovata", 409);
  const subjectIds = new Set(bindings.map((binding) => id(binding.subjectId)));
  persistedEdges.forEach((edge) => { subjectIds.add(id(edge.sourceSubjectId)); subjectIds.add(id(edge.targetSubjectId)); });
  const subjects = await Subject.find({ _id: { $in: [...subjectIds] } }).lean();
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  const bindingBySubjectId = new Map(bindings.map((binding) => [id(binding.subjectId), binding]));
  const relationTypeByDefinitionId = new Map((namespaceRevision.relationTypes || []).map((entry) => [String(entry.definitionId), entry]));
  const nodes = new Map();
  const canonicalIndex = new Map();
  const edgesFrom = new Map();
  const edgesTo = new Map();

  function addCanonical(ref, subjectId) {
    if (!ref?.scheme || !(ref.id || ref.refId)) return;
    const key = semanticRefKey(ref);
    if (!canonicalIndex.has(key)) canonicalIndex.set(key, new Set());
    canonicalIndex.get(key).add(id(subjectId));
  }
  function addEdge(edge) {
    const from = id(edge.fromSubjectId), to = id(edge.toSubjectId);
    if (!edgesFrom.has(from)) edgesFrom.set(from, []);
    if (!edgesTo.has(to)) edgesTo.set(to, []);
    edgesFrom.get(from).push(edge);
    edgesTo.get(to).push(edge);
  }

  for (const subjectId of subjectIds) {
    const subject = subjectById.get(subjectId);
    if (!subject) continue;
    const binding = bindingBySubjectId.get(subjectId) || null;
    nodes.set(subjectId, { subject, binding });
    for (const identity of subject.externalIdentities || []) addCanonical(identity, subjectId);
  }
  const authoritativeEdges = [];
  for (const persisted of persistedEdges) {
    const relationType = relationTypeByDefinitionId.get(String(persisted.relationTypeDefinitionId));
    if (!relationType || !nodes.has(id(persisted.sourceSubjectId)) || !nodes.has(id(persisted.targetSubjectId))) continue;
    authoritativeEdges.push(persisted);
    const direct = materializeDirectEdge(persisted, relationType);
    addEdge(direct);
    addEdge(materializeReverseEdge(persisted, relationType));
  }
  const graph = { revision, namespaceRevision, nodes, canonicalIndex, edgesFrom, edgesTo, authoritativeEdges, relationTypeByDefinitionId };
  touchCache(cacheKey, graph);
  return graph;
}

function resolveFeatureToSubjectIds(graph, feature = {}) {
  if (!graph || !feature?.kind) return [];
  if (feature.kind === "subject") return graph.nodes.has(id(feature.subjectId)) ? [id(feature.subjectId)] : [];
  if (feature.kind === "canonical") return [...(graph.canonicalIndex.get(semanticRefKey(feature)) || [])];
  const result = [];
  for (const [subjectId, node] of graph.nodes) {
    if (feature.kind === "subject_class" && (node.binding?.subjectClassDefinitionIds || []).includes(String(feature.definitionId))) result.push(subjectId);
    else if (feature.kind === "relation_type" && (graph.edgesFrom.get(subjectId) || []).some((edge) => edge.relationTypeDefinitionId === String(feature.definitionId))) result.push(subjectId);
  }
  return result;
}

function neighbors(graph, subjectId, { relationTypeDefinitionId = null } = {}) {
  return (graph?.edgesFrom.get(id(subjectId)) || []).filter((edge) => !relationTypeDefinitionId || edge.relationTypeDefinitionId === String(relationTypeDefinitionId));
}
function outgoingEdges(graph, subjectId) { return neighbors(graph, subjectId).filter((edge) => !edge.generated); }
function incomingEdges(graph, subjectId) { return neighbors(graph, subjectId).filter((edge) => edge.generated); }

function shortestSemanticPath(graph, { from, to, relationTypeDefinitionId = null, maxDepth = 3 } = {}) {
  const starts = resolveFeatureToSubjectIds(graph, from), goals = new Set(resolveFeatureToSubjectIds(graph, to));
  if (!starts.length || !goals.size) return null;
  for (const start of starts) if (goals.has(start)) return { subjectIds: [start], edges: [], depth: 0, strength: 1 };
  const queue = starts.map((start) => ({ subjectId: start, subjectIds: [start], edges: [], strength: 1 }));
  const bestDepth = new Map(starts.map((start) => [start, 0]));
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= Math.max(1, Math.min(6, Number(maxDepth) || 3))) continue;
    for (const edge of neighbors(graph, current.subjectId, { relationTypeDefinitionId })) {
      const nextId = id(edge.toSubjectId), depth = current.edges.length + 1;
      const next = { subjectId: nextId, subjectIds: [...current.subjectIds, nextId], edges: [...current.edges, edge], strength: current.strength * Math.max(0.05, edge.traversalWeight || 0.05) };
      if (goals.has(nextId)) return { subjectIds: next.subjectIds, edges: next.edges, depth, strength: next.strength };
      if ((bestDepth.get(nextId) ?? Infinity) <= depth) continue;
      bestDepth.set(nextId, depth);
      queue.push(next);
    }
  }
  return null;
}

module.exports = {
  id,
  semanticRefKey,
  relationStrength,
  edgeTraversalWeight,
  validateGraphSnapshotAgainstNamespace,
  createGraphRevision,
  loadSemanticGraphRevision,
  resolveFeatureToSubjectIds,
  neighbors,
  outgoingEdges,
  incomingEdges,
  shortestSemanticPath,
};
