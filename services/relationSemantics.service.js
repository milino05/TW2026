function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getReverseViewKey(relationTypeKey) {
  return `${normalizeKey(relationTypeKey)}:reverse`;
}

function isReverseViewKey(viewKey) {
  return typeof viewKey === "string" && viewKey.endsWith(":reverse");
}

function buildDirectRelationView(relationType) {
  return {
    viewKey: relationType.key,
    baseRelationTypeKey: relationType.key,
    direction: relationType.directionality === "symmetric" ? "symmetric" : "direct",
    label: relationType.label,
    description: relationType.description,
    domain: relationType.domain || [],
    range: relationType.range || [],
    category: relationType.category,
    strength: relationType.strength,
    userIntents: relationType.userIntents || [],
    semanticRefs: relationType.semanticRefs || [],
    validationRules: relationType.validationRules || {},
    generated: false,
  };
}

function buildReverseRelationView(relationType) {
  return {
    viewKey: getReverseViewKey(relationType.key),
    baseRelationTypeKey: relationType.key,
    direction: "reverse",
    label: relationType.reverse?.label || `Inverso di ${relationType.label}`,
    description: relationType.reverse?.description,
    domain: relationType.range || [],
    range: relationType.domain || [],
    category: relationType.category,
    strength: relationType.strength,
    userIntents: relationType.reverse?.userIntents || [],
    semanticRefs: relationType.semanticRefs || [],
    validationRules: relationType.validationRules || {},
    generated: true,
  };
}

function buildRelationViews(relationTypes = []) {
  const views = [];
  for (const relationType of relationTypes) {
    views.push(buildDirectRelationView(relationType));
    if (relationType.directionality !== "symmetric") views.push(buildReverseRelationView(relationType));
  }
  return views;
}

function getRelationViewByKey(relationViews, viewKey) {
  if (!Array.isArray(relationViews)) return null;
  return relationViews.find((view) => view.viewKey === normalizeKey(viewKey)) || null;
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
    relationId: edge._id,
    museumId: edge.museumId,
    sourceItemRevisionId: edge.sourceItemRevisionId,
    fromItemId: edge.sourceItemId,
    toItemId: edge.targetItemId,
    relationTypeKey: relationType.key,
    baseRelationTypeKey: relationType.key,
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
    fromItemId: edge.targetItemId,
    toItemId: edge.sourceItemId,
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
  isReverseViewKey,
  buildDirectRelationView,
  buildReverseRelationView,
  buildRelationViews,
  getRelationViewByKey,
  relationStrength,
  edgeTraversalWeight,
  materializeDirectEdge,
  materializeReverseEdge,
};
