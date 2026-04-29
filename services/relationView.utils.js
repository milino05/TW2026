function getReverseViewKey(relationTypeKey) {
  return `${relationTypeKey}:reverse`;
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
    validationRules: relationType.validationRules || {},
    generated: true,
  };
}

function buildRelationViews(relationTypes = []) {
  const views = [];

  relationTypes.forEach((relationType) => {
    views.push(buildDirectRelationView(relationType));

    if (relationType.directionality !== "symmetric") {
      views.push(buildReverseRelationView(relationType));
    }
  });

  return views;
}

function getRelationViewByKey(relationViews, viewKey) {
  return relationViews.find((view) => view.viewKey === viewKey) || null;
}

module.exports = {
  getReverseViewKey,
  isReverseViewKey,
  buildRelationViews,
  getRelationViewByKey,
};
