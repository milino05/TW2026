function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getReverseViewKey(relationType) {
  return `${normalizeKey(relationType?.key || relationType?.definitionId)}:reverse`;
}

function buildDirectRelationView(relationType) {
  return {
    viewKey: normalizeKey(relationType.key || relationType.definitionId),
    relationTypeDefinitionId: relationType.definitionId,
    direction: relationType.directionality === "symmetric" ? "symmetric" : "direct",
    label: relationType.label,
    description: relationType.description,
    domainDefinitionIds: relationType.domainDefinitionIds || [],
    rangeDefinitionIds: relationType.rangeDefinitionIds || [],
    category: relationType.category,
    strength: relationType.strength,
    userIntents: relationType.userIntents || [],
    semanticRefs: relationType.semanticRefs || [],
    generated: false,
  };
}

function buildReverseRelationView(relationType) {
  return {
    viewKey: getReverseViewKey(relationType),
    relationTypeDefinitionId: relationType.definitionId,
    direction: "reverse",
    label: relationType.reverse?.label || `Inverso di ${relationType.label}`,
    description: relationType.reverse?.description,
    domainDefinitionIds: relationType.rangeDefinitionIds || [],
    rangeDefinitionIds: relationType.domainDefinitionIds || [],
    category: relationType.category,
    strength: relationType.strength,
    userIntents: relationType.reverse?.userIntents || [],
    semanticRefs: relationType.semanticRefs || [],
    generated: true,
  };
}

function relationStrength(strength) {
  return strength === "strong" ? 1 : strength === "weak" ? 0.4 : 0.7;
}

function edgeTraversalWeight(edge, relationType) {
  return relationStrength(relationType?.strength) * Math.max(0, Math.min(1, (Number(edge?.weight) || 0) / 10));
}

function materializeDirectEdge(edge, relationType) {
  const view = buildDirectRelationView(relationType);
  return {
    edgeId: edge._id,
    graphRevisionId: edge.graphRevisionId,
    fromSubjectId: edge.sourceSubjectId,
    toSubjectId: edge.targetSubjectId,
    relationTypeDefinitionId: relationType.definitionId,
    relationTypeKey: relationType.key,
    viewKey: view.viewKey,
    direction: view.direction,
    label: view.label,
    description: view.description,
    generated: false,
    strength: relationType.strength,
    relationWeight: Number(edge.weight) || 0,
    traversalWeight: edgeTraversalWeight(edge, relationType),
    semanticRefs: relationType.semanticRefs || [],
  };
}

function materializeReverseEdge(edge, relationType) {
  const view = relationType.directionality === "symmetric"
    ? buildDirectRelationView(relationType)
    : buildReverseRelationView(relationType);
  return {
    ...materializeDirectEdge(edge, relationType),
    fromSubjectId: edge.targetSubjectId,
    toSubjectId: edge.sourceSubjectId,
    viewKey: view.viewKey,
    direction: view.direction,
    label: view.label,
    description: view.description,
    generated: true,
  };
}

module.exports = {
  normalizeKey,
  getReverseViewKey,
  buildDirectRelationView,
  buildReverseRelationView,
  relationStrength,
  edgeTraversalWeight,
  materializeDirectEdge,
  materializeReverseEdge,
};
