function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function getReverseViewKey(relationTypeKey) { return `${normalizeKey(relationTypeKey)}:reverse`; }
function isReverseViewKey(viewKey) { return typeof viewKey === "string" && viewKey.endsWith(":reverse"); }

function directView(type) {
  return {
    viewKey: type.key,
    baseRelationTypeKey: type.key,
    direction: type.directionality === "symmetric" ? "symmetric" : "direct",
    label: type.label,
    description: type.description,
    domain: type.domain || [],
    range: type.range || [],
    category: type.category,
    strength: type.strength,
    userIntents: type.userIntents || [],
    validationRules: type.validationRules || {},
    semanticRefs: type.semanticRefs || [],
    generated: false,
  };
}

function reverseView(type) {
  if (type.directionality === "symmetric") return directView(type);
  return {
    viewKey: getReverseViewKey(type.key),
    baseRelationTypeKey: type.key,
    direction: "reverse",
    label: type.reverse?.label || `Inverso di ${type.label}`,
    description: type.reverse?.description,
    domain: type.range || [],
    range: type.domain || [],
    category: type.category,
    strength: type.strength,
    userIntents: type.reverse?.userIntents || [],
    validationRules: type.validationRules || {},
    semanticRefs: type.semanticRefs || [],
    generated: true,
  };
}

function buildRelationViews(relationTypes = []) {
  const views = [];
  for (const type of relationTypes) {
    views.push(directView(type));
    if (type.directionality !== "symmetric") views.push(reverseView(type));
  }
  return views;
}

function relationView(type, direction = "direct") {
  if (!type) return null;
  if (type.directionality === "symmetric") return directView(type);
  return direction === "reverse" ? reverseView(type) : directView(type);
}

function getRelationViewByKey(relationViews, viewKey) {
  return Array.isArray(relationViews) ? relationViews.find((view) => view.viewKey === viewKey) || null : null;
}

module.exports = { normalizeKey, getReverseViewKey, isReverseViewKey, directView, reverseView, relationView, buildRelationViews, getRelationViewByKey };
