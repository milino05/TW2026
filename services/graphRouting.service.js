const policy = require("../config/adaptivePolicy");

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function fallbackPaceFactor(preference = 0.5) {
  const value = clamp(Number(preference), 0, 1);
  if (value <= 0.5) {
    const ratio = value / 0.5;
    return policy.coldStart.paceFactors.calm
      + ratio * (policy.coldStart.paceFactors.normal - policy.coldStart.paceFactors.calm);
  }
  const ratio = (value - 0.5) / 0.5;
  return policy.coldStart.paceFactors.normal
    + ratio * (policy.coldStart.paceFactors.fast - policy.coldStart.paceFactors.normal);
}

function attributeValueMap(entity) {
  return new Map((entity?.attributeValues || []).map((entry) => [String(entry.physicalAttributeDefinitionId), entry.value]));
}
function actualMatchesRequirement(actual, requirement) {
  const expected = requirement.value;
  switch (requirement.operator || "eq") {
    case "eq": return actual === expected;
    case "neq": return actual !== undefined && actual !== expected;
    case "gte": return actual !== undefined && Number(actual) >= Number(expected);
    case "lte": return actual !== undefined && Number(actual) <= Number(expected);
    case "gt": return actual !== undefined && Number(actual) > Number(expected);
    case "lt": return actual !== undefined && Number(actual) < Number(expected);
    case "in": return actual !== undefined && Array.isArray(expected) && expected.includes(actual);
    default: return false;
  }
}
function evaluateRequirement(attributeValues, requirement) {
  const actual = attributeValues instanceof Map
    ? attributeValues.get(String(requirement.physicalAttributeDefinitionId))
    : undefined;
  return actualMatchesRequirement(actual, requirement);
}
function traversalAttributeValue(connection, destinationPlace, requirement) {
  const definitionId = String(requirement.physicalAttributeDefinitionId);
  const connectionValues = attributeValueMap(connection);
  const placeValues = attributeValueMap(destinationPlace);
  const appliesTo = requirement.appliesTo || "connection";
  if (appliesTo === "place") return placeValues.get(definitionId);
  if (appliesTo === "both") {
    // Connection evidence is more specific for a traversal; Place evidence is a fallback
    // when the same physical attribute is authored on the spatial node instead.
    return connectionValues.has(definitionId)
      ? connectionValues.get(definitionId)
      : placeValues.get(definitionId);
  }
  return connectionValues.get(definitionId);
}
function traversalRequirementMatches(connection, destinationPlace, requirement) {
  return actualMatchesRequirement(traversalAttributeValue(connection, destinationPlace, requirement), requirement);
}
function edgeCompatible(connection, requirements = [], destinationPlace = null) {
  return requirements
    .filter((requirement) => requirement.priority === "required")
    .every((requirement) => traversalRequirementMatches(connection, destinationPlace, requirement));
}
function preferencePenalty(connection, requirements = [], destinationPlace = null) {
  return requirements.filter((requirement) => requirement.priority !== "required").reduce((total, requirement) => {
    const matches = traversalRequirementMatches(connection, destinationPlace, requirement);
    const penalized = requirement.priority === "avoid" ? matches : !matches;
    return penalized ? total + Math.max(0, Number(requirement.weight ?? 1)) : total;
  }, 0);
}
function pacePreferenceToSpeed(preference = 0.5, { baselineSpeedMps = policy.coldStart.movementSpeedMps } = {}) {
  return Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, baselineSpeedMps * fallbackPaceFactor(preference)));
}
function estimateConnectionSeconds(connection, options = {}) {
  const speedMps = Math.max(policy.movement.minSpeedMps, Number(options.speedMps) || policy.coldStart.movementSpeedMps);
  const learnedResidualSeconds = Number(options.learnedResidualSeconds) || 0;
  const movementSeconds = (Number(connection.distanceMeters) || 0) / speedMps;
  const fixedDelay = Number(connection.additionalDelaySeconds) || 0;
  return Math.max(0, movementSeconds + fixedDelay + learnedResidualSeconds);
}
function edgeView(connection, direction, seconds, penalty = 0) {
  const forward = direction === "forward";
  return {
    connectionId: connection._id,
    direction,
    fromPlaceId: forward ? String(connection.fromPlaceId) : String(connection.toPlaceId),
    toPlaceId: forward ? String(connection.toPlaceId) : String(connection.fromPlaceId),
    instruction: forward ? connection.instructions?.forward || null : connection.instructions?.backward || null,
    distanceMeters: Number(connection.distanceMeters) || 0,
    estimatedSeconds: seconds,
    preferencePenalty: penalty,
  };
}
function placeMap(places = []) { return new Map((places || []).map((place) => [String(place._id), place])); }
function directedEdge(connection, direction, { requirements, placesById, speedMps, learnedResidualByConnection, preferSoftConstraints }) {
  const forward = direction === "forward";
  const from = forward ? String(connection.fromPlaceId) : String(connection.toPlaceId);
  const to = forward ? String(connection.toPlaceId) : String(connection.fromPlaceId);
  const destinationPlace = placesById.get(to) || null;
  if (!edgeCompatible(connection, requirements, destinationPlace)) return null;
  const penalty = preferencePenalty(connection, requirements, destinationPlace);
  const residual = learnedResidualByConnection?.[String(connection._id)] || 0;
  const seconds = estimateConnectionSeconds(connection, { speedMps, learnedResidualSeconds: residual });
  const cost = preferSoftConstraints ? seconds * (1 + penalty * policy.routing.preferenceCostMultiplier) : seconds;
  return { connection, from, to, seconds, cost, penalty, direction };
}
function buildDirectedEdges(connections, options = {}) {
  const edges = [];
  const placesById = placeMap(options.places || []);
  for (const connection of connections || []) {
    const forward = directedEdge(connection, "forward", { ...options, placesById });
    if (forward) edges.push(forward);
    if (connection.directionality === "bidirectional") {
      const backward = directedEdge(connection, "backward", { ...options, placesById });
      if (backward) edges.push(backward);
    }
  }
  return edges;
}
function dijkstra({ connections, places = [], fromPlaceId, toPlaceId, requirements, speedMps, learnedResidualByConnection, preferSoftConstraints }) {
  const source = String(fromPlaceId);
  const target = String(toPlaceId);
  if (source === target) return { reachable: true, path: [], estimatedSeconds: 0, distanceMeters: 0, preferencePenalty: 0 };
  const edges = buildDirectedEdges(connections, { places, requirements, speedMps, learnedResidualByConnection, preferSoftConstraints });
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  const distances = new Map([[source, 0]]);
  const previous = new Map();
  const visited = new Set();
  while (true) {
    let current = null;
    let best = Infinity;
    for (const [node, distance] of distances.entries()) {
      if (!visited.has(node) && distance < best) { best = distance; current = node; }
    }
    if (current === null || current === target) break;
    visited.add(current);
    for (const edge of adjacency.get(current) || []) {
      const candidate = best + edge.cost;
      if (candidate < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, edge);
      }
    }
  }
  if (!distances.has(target)) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
  const path = [];
  let cursor = target;
  while (cursor !== source) {
    const edge = previous.get(cursor);
    if (!edge) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
    path.unshift(edge);
    cursor = edge.from;
  }
  return {
    reachable: true,
    path: path.map((edge) => edgeView(edge.connection, edge.direction, edge.seconds, edge.penalty)),
    estimatedSeconds: path.reduce((sum, edge) => sum + edge.seconds, 0),
    distanceMeters: path.reduce((sum, edge) => sum + (Number(edge.connection.distanceMeters) || 0), 0),
    preferencePenalty: path.reduce((sum, edge) => sum + edge.penalty, 0),
  };
}
function resolveRoute({ connections, places = [], fromPlaceId, toPlaceId, requirements = [], speedMps = policy.coldStart.movementSpeedMps, learnedResidualByConnection = {} }) {
  const fastest = dijkstra({ connections, places, fromPlaceId, toPlaceId, requirements, speedMps, learnedResidualByConnection, preferSoftConstraints: false });
  if (!fastest.reachable) return fastest;
  const preferredRequirements = requirements.filter((entry) => entry.priority !== "required");
  if (!preferredRequirements.length) return fastest;
  const preferred = dijkstra({ connections, places, fromPlaceId, toPlaceId, requirements, speedMps, learnedResidualByConnection, preferSoftConstraints: true });
  if (!preferred.reachable) return fastest;
  const maxPreferredSeconds = fastest.estimatedSeconds * (1 + policy.routing.maxPreferredDetourRatio);
  return preferred.preferencePenalty < fastest.preferencePenalty && preferred.estimatedSeconds <= maxPreferredSeconds ? preferred : fastest;
}
function resolvePlannedPath({ connections, places = [], pathConnectionIds = [], fromPlaceId, toPlaceId, requirements = [], speedMps = policy.coldStart.movementSpeedMps, learnedResidualByConnection = {} }) {
  const byId = new Map((connections || []).map((connection) => [String(connection._id), connection]));
  const placesById = placeMap(places);
  let cursor = String(fromPlaceId);
  const target = String(toPlaceId);
  const path = [];
  for (const connectionId of pathConnectionIds) {
    const connection = byId.get(String(connectionId));
    if (!connection) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
    let direction = null;
    if (String(connection.fromPlaceId) === cursor) direction = "forward";
    else if (connection.directionality === "bidirectional" && String(connection.toPlaceId) === cursor) direction = "backward";
    else return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
    const nextPlaceId = direction === "forward" ? String(connection.toPlaceId) : String(connection.fromPlaceId);
    const destinationPlace = placesById.get(nextPlaceId) || null;
    if (!edgeCompatible(connection, requirements, destinationPlace)) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
    const residual = learnedResidualByConnection[String(connection._id)] || 0;
    const seconds = estimateConnectionSeconds(connection, { speedMps, learnedResidualSeconds: residual });
    const penalty = preferencePenalty(connection, requirements, destinationPlace);
    const view = edgeView(connection, direction, seconds, penalty);
    path.push(view);
    cursor = view.toPlaceId;
  }
  if (cursor !== target) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null, preferencePenalty: null };
  return {
    reachable: true,
    path,
    estimatedSeconds: path.reduce((sum, edge) => sum + edge.estimatedSeconds, 0),
    distanceMeters: path.reduce((sum, edge) => sum + edge.distanceMeters, 0),
    preferencePenalty: path.reduce((sum, edge) => sum + edge.preferencePenalty, 0),
  };
}
function routeCompatible({ connections, places = [], pathConnectionIds, requirements = [], fromPlaceId = null, toPlaceId = null }) {
  if (fromPlaceId != null && toPlaceId != null) {
    return resolvePlannedPath({ connections, places, pathConnectionIds, requirements, fromPlaceId, toPlaceId }).reachable;
  }
  const byId = new Map((connections || []).map((connection) => [String(connection._id), connection]));
  return (pathConnectionIds || []).every((connectionId) => {
    const connection = byId.get(String(connectionId));
    return connection && edgeCompatible(connection, requirements, null);
  });
}

module.exports = {
  attributeValueMap,
  evaluateRequirement,
  traversalAttributeValue,
  traversalRequirementMatches,
  edgeCompatible,
  preferencePenalty,
  pacePreferenceToSpeed,
  estimateConnectionSeconds,
  resolveRoute,
  resolvePlannedPath,
  routeCompatible,
};
