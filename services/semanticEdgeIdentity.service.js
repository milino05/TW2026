function id(value) {
  return String(value?._id || value || "");
}

function relationDefinition(namespaceRevision, relationTypeDefinitionId) {
  return (namespaceRevision?.relationTypes || []).find((entry) => (
    String(entry.definitionId) === String(relationTypeDefinitionId)
  )) || null;
}

function canonicalEdgeParts(edge, namespaceRevision) {
  const relationTypeDefinitionId = String(edge?.relationTypeDefinitionId || "");
  let sourceSubjectId = id(edge?.sourceSubjectId);
  let targetSubjectId = id(edge?.targetSubjectId);
  const relation = relationDefinition(namespaceRevision, relationTypeDefinitionId);
  if (relation?.directionality === "symmetric" && targetSubjectId.localeCompare(sourceSubjectId) < 0) {
    [sourceSubjectId, targetSubjectId] = [targetSubjectId, sourceSubjectId];
  }
  return { sourceSubjectId, targetSubjectId, relationTypeDefinitionId };
}

function canonicalEdgeKey(edge, namespaceRevision) {
  const parts = canonicalEdgeParts(edge, namespaceRevision);
  return JSON.stringify([
    parts.sourceSubjectId,
    parts.relationTypeDefinitionId,
    parts.targetSubjectId,
  ]);
}

module.exports = {
  canonicalEdgeParts,
  canonicalEdgeKey,
  relationDefinition,
};
