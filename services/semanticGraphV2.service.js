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

async function findContextOrFail(editorialContextId) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("EditorialContext non trovato", 404);
  return context;
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

function validateGraphSnapshotAgainstNamespace({ subjectBindings = [], edges = [] }, namespaceRevision) {
  const issues = [];
  const classIds = new Set((namespaceRevision.subjectClasses || []).map((entry) => String(entry.definitionId)));
  const relationById = new Map((namespaceRevision.relationTypes || []).map((entry) => [String(entry.definitionId), entry]));
  const classesBySubject = new Map(subjectBindings.map((binding) => [String(binding.subjectId), new Set(binding.subjectClassDefinitionIds || [])]));

  subjectBindings.forEach((binding, index) => {
    (binding.subjectClassDefinitionIds || []).forEach((definitionId, classIndex) => {
      if (!classIds.has(String(definitionId))) issues.push({ field: `subjectBindings[${index}].subjectClassDefinitionIds[${classIndex}]`, code: "UNKNOWN_SUBJECT_CLASS", message: `SubjectClass non disponibile: ${definitionId}` });
    });
  });

  edges.forEach((edge, index) => {
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

async function validateSubjectsExist({ subjectBindings = [], edges = [] }) {
  const ids = new Set();
  for (const binding of subjectBindings) ids.add(String(binding.subjectId));
  for (const edge of edges) { ids.add(String(edge.sourceSubjectId)); ids.add(String(edge.targetSubjectId)); }
  const values = [...ids].filter(Boolean);
  if (!values.length) return [];
  const found = await Subject.find({ _id: { $in: values } }).select("_id").lean();
  const foundIds = new Set(found.map((entry) => String(entry._id)));
  return values.filter((subjectId) => !foundIds.has(subjectId)).map((subjectId) => ({ field: "subjectId", code: "SUBJECT_NOT_FOUND", message: `Subject non trovato: ${subjectId}` }));
}

async function nextVersion(editorialContextId) {
  const latest = await SemanticGraphRevision.findOne({ editorialContextId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function createGraphRevision({ editorialContextId, payload, actorUserId }) {
  const rawPayload = payload || {};
  const shapeIssues = validateGraphRevisionPayload(rawPayload);
  if (shapeIssues.length) throw new AppError("Payload GraphRevision non valido", 400, shapeIssues);
  const normalized = normalizeGraphRevisionPayload(rawPayload);
  const context = await findContextOrFail(editorialContextId);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const { namespace, namespaceRevision } = await resolveNamespaceRevision(context, normalized.authoredAgainstNamespaceRevisionId);
  await assertCanUseNamespaceForAuthoring({ namespace, actorUserId });

  if (normalized.basedOnRevisionId) {
    const base = await SemanticGraphRevision.findOne({ _id: normalized.basedOnRevisionId, editorialContextId: context._id });
    if (!base) throw new AppError("GraphRevision base non appartiene al Context", 409);
  }

  const semanticIssues = [
    ...await validateSubjectsExist(normalized),
    ...validateGraphSnapshotAgainstNamespace(normalized, namespaceRevision),
  ];
  if (semanticIssues.length) throw new AppError("GraphRevision non coerente", 409, semanticIssues);

  const graphRevision = await SemanticGraphRevision.create({
    editorialContextId: context._id,
    version: await nextVersion(context._id),
    basedOnRevisionId: normalized.basedOnRevisionId || context.workingGraphRevisionId || null,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    createdBy: actorUserId,
  });

  try {
    if (normalized.subjectBindings.length) {
      await GraphSubjectBinding.insertMany(normalized.subjectBindings.map((binding) => ({
        graphRevisionId: graphRevision._id,
        subjectId: binding.subjectId,
        subjectClassDefinitionIds: binding.subjectClassDefinitionIds,
      })));
    }
    if (normalized.edges.length) {
      await SemanticEdgeV2.insertMany(normalized.edges.map((edge) => ({
        graphRevisionId: graphRevision._id,
        sourceSubjectId: edge.sourceSubjectId,
        targetSubjectId: edge.targetSubjectId,
        relationTypeDefinitionId: edge.relationTypeDefinitionId,
        weight: edge.weight,
        metadata: edge.metadata || null,
        provenance: edge.provenance || null,
      })));
    }
    context.workingGraphRevisionId = graphRevision._id;
    await context.save();
    graphCache.delete(id(graphRevision._id));
    return graphRevision;
  } catch (error) {
    await Promise.all([
      GraphSubjectBinding.deleteMany({ graphRevisionId: graphRevision._id }),
      SemanticEdgeV2.deleteMany({ graphRevisionId: graphRevision._id }),
    ]).catch(() => {});
    await graphRevision.deleteOne().catch(() => {});
    throw error;
  }
}

async function loadSemanticGraphRevision(graphRevisionId, { namespaceRevisionId = null } = {}) {
  const cacheKey = `${id(graphRevisionId)}:${id(namespaceRevisionId)}`;
  if (graphCache.has(cacheKey)) {
    const cached = graphCache.get(cacheKey);
    touchCache(cacheKey, cached);
    return cached;
  }
  const graphRevision = await SemanticGraphRevision.findById(graphRevisionId).lean();
  if (!graphRevision) throw new AppError("GraphRevision non trovata", 404);
  const [subjectBindings, edges] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId }).lean(),
    SemanticEdgeV2.find({ graphRevisionId }).lean(),
  ]);
  let namespaceRevision = null;
  if (namespaceRevisionId) {
    namespaceRevision = await NamespaceRevision.findById(namespaceRevisionId).lean();
    if (!namespaceRevision) throw new AppError("NamespaceRevision non trovata", 404);
    const issues = validateGraphSnapshotAgainstNamespace({ subjectBindings, edges }, namespaceRevision);
    if (issues.length) throw new AppError("GraphRevision non coerente con la NamespaceRevision richiesta", 409, issues);
  }
  const relationById = new Map((namespaceRevision?.relationTypes || []).map((entry) => [String(entry.definitionId), entry]));
  const adjacency = new Map();
  const reverseAdjacency = new Map();
  const materializedEdges = [];
  function add(map, key, edge) { if (!map.has(key)) map.set(key, []); map.get(key).push(edge); }
  for (const edge of edges) {
    const relation = relationById.get(String(edge.relationTypeDefinitionId)) || null;
    const direct = materializeDirectEdge(edge, relation);
    materializedEdges.push(direct);
    add(adjacency, id(direct.sourceSubjectId), direct);
    add(reverseAdjacency, id(direct.targetSubjectId), direct);
    const reverse = materializeReverseEdge(edge, relation);
    if (reverse) {
      materializedEdges.push(reverse);
      add(adjacency, id(reverse.sourceSubjectId), reverse);
      add(reverseAdjacency, id(reverse.targetSubjectId), reverse);
    }
  }
  const result = {
    graphRevision,
    namespaceRevision,
    subjectBindings,
    directEdges: edges,
    edges: materializedEdges,
    adjacency,
    reverseAdjacency,
  };
  touchCache(cacheKey, result);
  return result;
}

function shortestSemanticPath(graph, sourceSubjectId, targetSubjectId, { maxDepth = 8 } = {}) {
  const source = id(sourceSubjectId), target = id(targetSubjectId);
  if (source === target) return { subjectIds: [sourceSubjectId], edges: [], cost: 0 };
  const queue = [{ subjectId: source, cost: 0, depth: 0, subjects: [sourceSubjectId], edges: [] }];
  const best = new Map([[source, 0]]);
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    for (const edge of graph.adjacency.get(current.subjectId) || []) {
      const next = id(edge.targetSubjectId);
      const cost = current.cost + edgeTraversalWeight(edge);
      if (best.has(next) && best.get(next) <= cost) continue;
      const state = {
        subjectId: next,
        cost,
        depth: current.depth + 1,
        subjects: [...current.subjects, edge.targetSubjectId],
        edges: [...current.edges, edge],
      };
      if (next === target) return { subjectIds: state.subjects, edges: state.edges, cost };
      best.set(next, cost);
      queue.push(state);
    }
  }
  return null;
}

function relationCoherenceScore(graph, sourceSubjectId, targetSubjectId) {
  let best = 0;
  for (const edge of graph.adjacency.get(id(sourceSubjectId)) || []) {
    if (id(edge.targetSubjectId) !== id(targetSubjectId)) continue;
    best = Math.max(best, relationStrength(edge));
  }
  return best;
}

module.exports = {
  validateGraphSnapshotAgainstNamespace,
  createGraphRevision,
  loadSemanticGraphRevision,
  shortestSemanticPath,
  relationCoherenceScore,
  semanticRefKey,
};
