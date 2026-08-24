function id(value) { return String(value?._id || value || ""); }
function canonicalKey(ref) { return `${String(ref?.scheme || "").trim().toLowerCase()}::${String(ref?.id || ref?.refId || "").trim()}`; }

function buildFederatedSemanticGraph(graphBundles = []) {
  const nodes = new Map();
  const canonicalIndex = new Map();
  const edgesFrom = new Map();
  const bindingsByNamespaceSubject = new Map();
  const namespaceIds = new Set();

  function addCanonical(ref, subjectId) {
    if (!ref?.scheme || !(ref.id || ref.refId)) return;
    const key = canonicalKey(ref);
    if (!canonicalIndex.has(key)) canonicalIndex.set(key, new Set());
    canonicalIndex.get(key).add(id(subjectId));
  }
  function addEdge(edge) {
    const from = id(edge.fromSubjectId);
    if (!edgesFrom.has(from)) edgesFrom.set(from, []);
    edgesFrom.get(from).push(edge);
  }

  for (const bundle of graphBundles) {
    const namespaceId = id(bundle.namespaceId);
    namespaceIds.add(namespaceId);
    for (const [subjectId, node] of bundle.graph.nodes || []) {
      const key = id(subjectId);
      if (!nodes.has(key)) nodes.set(key, { subject: node.subject, sources: [] });
      const merged = nodes.get(key);
      merged.sources.push({
        editorialReleaseId: bundle.editorialReleaseId,
        editorialContextId: bundle.editorialContextId,
        namespaceId: bundle.namespaceId,
        graphRevisionId: bundle.graph.revision?._id || null,
      });
      for (const identity of node.subject?.externalIdentities || []) addCanonical(identity, key);
      bindingsByNamespaceSubject.set(`${namespaceId}:${key}`, node.binding || null);
    }
    for (const [fromSubjectId, edges] of bundle.graph.edgesFrom || []) {
      for (const edge of edges) {
        addEdge({
          ...edge,
          namespaceId: bundle.namespaceId,
          namespaceRevisionId: bundle.namespaceRevisionId,
          editorialReleaseId: bundle.editorialReleaseId,
          editorialContextId: bundle.editorialContextId,
        });
      }
    }
  }
  return { nodes, canonicalIndex, edgesFrom, bindingsByNamespaceSubject, namespaceIds };
}

function resolveFeatureToSubjectIds(graph, feature = {}) {
  if (!graph || !feature?.kind) return [];
  if (feature.kind === "subject") return graph.nodes.has(id(feature.subjectId)) ? [id(feature.subjectId)] : [];
  if (feature.kind === "canonical") return [...(graph.canonicalIndex.get(canonicalKey(feature)) || [])];
  if (!["subject_class", "relation_type"].includes(feature.kind)) return [];
  const namespaceId = id(feature.namespaceId);
  const definitionId = String(feature.definitionId || "");
  if (!namespaceId || !definitionId) return [];
  if (feature.kind === "subject_class") {
    const result = [];
    for (const subjectId of graph.nodes.keys()) {
      const binding = graph.bindingsByNamespaceSubject.get(`${namespaceId}:${subjectId}`);
      if ((binding?.subjectClassDefinitionIds || []).some((entry) => String(entry) === definitionId)) result.push(subjectId);
    }
    return result;
  }
  const result = [];
  for (const [subjectId, edges] of graph.edgesFrom) {
    if (edges.some((edge) => id(edge.namespaceId) === namespaceId && String(edge.relationTypeDefinitionId) === definitionId)) result.push(subjectId);
  }
  return result;
}

function neighbors(graph, subjectId, { relationType = null } = {}) {
  const values = graph?.edgesFrom.get(id(subjectId)) || [];
  if (!relationType) return values;
  return values.filter((edge) => id(edge.namespaceId) === id(relationType.namespaceId)
    && String(edge.relationTypeDefinitionId) === String(relationType.definitionId));
}

function shortestSemanticPath(graph, { from, to, relationType = null, maxDepth = 3 } = {}) {
  const starts = resolveFeatureToSubjectIds(graph, from);
  const goals = new Set(resolveFeatureToSubjectIds(graph, to));
  if (!starts.length || !goals.size) return null;
  for (const start of starts) if (goals.has(start)) return { subjectIds: [start], edges: [], depth: 0, strength: 1 };
  const limit = Math.max(1, Math.min(6, Number(maxDepth) || 3));
  const queue = starts.map((subjectId) => ({ subjectId, subjectIds: [subjectId], edges: [], strength: 1 }));
  const bestDepth = new Map(starts.map((subjectId) => [subjectId, 0]));
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= limit) continue;
    for (const edge of neighbors(graph, current.subjectId, { relationType })) {
      const nextId = id(edge.toSubjectId);
      const depth = current.edges.length + 1;
      const next = {
        subjectId: nextId,
        subjectIds: [...current.subjectIds, nextId],
        edges: [...current.edges, edge],
        strength: current.strength * Math.max(0.05, Number(edge.traversalWeight) || 0.05),
      };
      if (goals.has(nextId)) return { subjectIds: next.subjectIds, edges: next.edges, depth, strength: next.strength };
      if ((bestDepth.get(nextId) ?? Infinity) <= depth) continue;
      bestDepth.set(nextId, depth);
      queue.push(next);
    }
  }
  return null;
}

function relationCoherence(graph, leftSubjectId, rightSubjectId) {
  if (!leftSubjectId || !rightSubjectId || id(leftSubjectId) === id(rightSubjectId)) return 0;
  const direct = neighbors(graph, leftSubjectId).filter((edge) => id(edge.toSubjectId) === id(rightSubjectId));
  const reverse = neighbors(graph, rightSubjectId).filter((edge) => id(edge.toSubjectId) === id(leftSubjectId));
  const values = [...direct, ...reverse].map((edge) => Number(edge.traversalWeight) || 0).filter(Number.isFinite);
  return values.length ? Math.min(0.35, Math.max(...values) * 0.25) : 0;
}

module.exports = {
  id,
  canonicalKey,
  buildFederatedSemanticGraph,
  resolveFeatureToSubjectIds,
  neighbors,
  shortestSemanticPath,
  relationCoherence,
};
