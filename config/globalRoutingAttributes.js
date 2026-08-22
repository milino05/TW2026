const GLOBAL_ROUTING_ATTRIBUTE_CATALOG = Object.freeze({
  step_free: Object.freeze({
    key: "step_free",
    label: "Percorso senza gradini",
    dataType: "boolean",
    obstacleWhen: false,
  }),
  wheelchair_accessible: Object.freeze({
    key: "wheelchair_accessible",
    label: "Accessibile in sedia a rotelle",
    dataType: "boolean",
    obstacleWhen: false,
  }),
  stairs_present: Object.freeze({
    key: "stairs_present",
    label: "Presenza di scale",
    dataType: "boolean",
    obstacleWhen: true,
  }),
});

function canonicalRoutingAttribute(key) {
  return GLOBAL_ROUTING_ATTRIBUTE_CATALOG[String(key || "").trim().toLowerCase()] || null;
}

function isDeclaredObstacle(definition, value) {
  if (!definition || definition.obstacleWhen === undefined) return false;
  return value === definition.obstacleWhen;
}

module.exports = {
  GLOBAL_ROUTING_ATTRIBUTE_CATALOG,
  canonicalRoutingAttribute,
  isDeclaredObstacle,
};
