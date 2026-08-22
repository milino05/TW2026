const GLOBAL_ROUTING_ATTRIBUTE_CATALOG = Object.freeze([
  { key: "step_free", label: "Senza gradini", dataType: "boolean", appliesTo: "connection", obstacleWhen: false },
  { key: "tactile_guidance", label: "Guida tattile", dataType: "boolean", appliesTo: "connection", obstacleWhen: false },
  { key: "minimum_width_cm", label: "Larghezza minima", dataType: "number", unit: "cm", appliesTo: "connection" },
  { key: "low_sensory_load", label: "Basso carico sensoriale", dataType: "boolean", appliesTo: "both", obstacleWhen: false },
  { key: "stairs", label: "Presenza di scale", dataType: "boolean", appliesTo: "connection", obstacleWhen: true },
  { key: "elevator", label: "Uso ascensore", dataType: "boolean", appliesTo: "connection" },
  { key: "narrow_passage", label: "Passaggio stretto", dataType: "boolean", appliesTo: "connection", obstacleWhen: true },
  { key: "quiet_area", label: "Area tranquilla", dataType: "boolean", appliesTo: "place" },
]);

const GLOBAL_PLACE_INTENTS = Object.freeze([
  "FIND_ENTRANCE",
  "FIND_EXIT",
  "FIND_EMERGENCY_EXIT",
  "FIND_TOILET",
  "FIND_BAR",
  "FIND_SHOP",
  "FIND_INFO",
]);

function getRoutingAttributeCatalog() {
  return {
    attributes: GLOBAL_ROUTING_ATTRIBUTE_CATALOG.map((entry) => ({ ...entry })),
    placeIntents: [...GLOBAL_PLACE_INTENTS],
  };
}

function getCanonicalAttribute(key) {
  return GLOBAL_ROUTING_ATTRIBUTE_CATALOG.find((entry) => entry.key === String(key || "").trim().toLowerCase()) || null;
}

function isDeclaredObstacle(definition, value) {
  return definition?.obstacleWhen !== undefined && value === definition.obstacleWhen;
}

module.exports = {
  GLOBAL_ROUTING_ATTRIBUTE_CATALOG,
  GLOBAL_PLACE_INTENTS,
  getRoutingAttributeCatalog,
  getCanonicalAttribute,
  isDeclaredObstacle,
};