function evaluateRequirement(attributes, requirement) {
  const actual = attributes?.[requirement.attributeKey];
  const expected = requirement.value;
  switch (requirement.operator || "eq") {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "gte": return Number(actual) >= Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "in": return Array.isArray(expected) && expected.includes(actual);
    default: return false;
  }
}

function edgeCompatible(connection, requirements = []) {
  return requirements
    .filter((requirement) => requirement.priority === "required")
    .every((requirement) => evaluateRequirement(connection.attributes || {}, requirement));
}

function preferencePenalty(connection, requirements = []) {
  return requirements
    .filter((requirement) => requirement.priority !== "required")
    .reduce((total, requirement) => {
      if (evaluateRequirement(connection.attributes || {}, requirement)) return total;
      return total + Math.max(0, Number(requirement.weight ?? 1));
    }, 0);
}

function pacePreferenceToSpeed(preference = 0.5, { minSpeedMps = 0.6, maxSpeedMps = 1.4 } = {}) {
  const value = Math.max(0, Math.min(1, Number(preference)));
  return minSpeedMps + value * (maxSpeedMps - minSpeedMps);
}

function estimateConnectionSeconds(connection, options = {}) {
  const speedMps = Math.max(0.1, Number(options.speedMps) || 1);
  const learnedResidualSeconds = Number(options.learnedResidualSeconds) || 0;
  const userCorrectionFactor = Math.max(0.1, Number(options.userCorrectionFactor) || 1);
  const movementSeconds = (Number(connection.distanceMeters) || 0) / speedMps;
  const fixedDelay = Number(connection.additionalDelaySeconds) || 0;
  return Math.max(0, (movementSeconds + fixedDelay + learnedResidualSeconds) * userCorrectionFactor);
}

function buildDirectedEdges(connections, options = {}) {
  const edges = [];
  for (const connection of connections || []) {
    if (!edgeCompatible(connection, options.requirements)) continue;
    const penalty = preferencePenalty(connection, options.requirements);
    const residual = options.learnedResidualByConnection?.[String(connection._id)] || 0;
    const seconds = estimateConnectionSeconds(connection, {
      speedMps: options.speedMps,
      learnedResidualSeconds: residual,
      userCorrectionFactor: options.userCorrectionFactor,
    });
    const preferencePenaltySeconds = penalty * (Number(options.preferencePenaltySeconds) || 20);
    edges.push({ connection, from: String(connection.fromPlaceId), to: String(connection.toPlaceId), seconds, cost: seconds + preferencePenaltySeconds, direction: "forward" });
    if (connection.directionality === "bidirectional") {
      edges.push({ connection, from: String(connection.toPlaceId), to: String(connection.fromPlaceId), seconds, cost: seconds + preferencePenaltySeconds, direction: "backward" });
    }
  }
  return edges;
}

function resolveRoute({ connections, fromPlaceId, toPlaceId, requirements = [], speedMps = 1, learnedResidualByConnection = {}, userCorrectionFactor = 1 }) {
  const source = String(fromPlaceId);
  const target = String(toPlaceId);
  if (source === target) return { reachable: true, path: [], estimatedSeconds: 0, distanceMeters: 0 };
  const edges = buildDirectedEdges(connections, { requirements, speedMps, learnedResidualByConnection, userCorrectionFactor });
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
      if (candidate < (distances.get(edge.to) ?? Infinity)) { distances.set(edge.to, candidate); previous.set(edge.to, edge); }
    }
  }
  if (!distances.has(target)) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null };
  const path = [];
  let cursor = target;
  while (cursor !== source) {
    const edge = previous.get(cursor);
    if (!edge) return { reachable: false, path: [], estimatedSeconds: null, distanceMeters: null };
    path.unshift(edge);
    cursor = edge.from;
  }
  return {
    reachable: true,
    path: path.map((edge) => ({ connectionId: edge.connection._id, direction: edge.direction, fromPlaceId: edge.from, toPlaceId: edge.to, instruction: edge.direction === "forward" ? edge.connection.instructions?.forward || null : edge.connection.instructions?.backward || null, distanceMeters: edge.connection.distanceMeters, estimatedSeconds: edge.seconds })),
    estimatedSeconds: path.reduce((sum, edge) => sum + edge.seconds, 0),
    distanceMeters: path.reduce((sum, edge) => sum + (Number(edge.connection.distanceMeters) || 0), 0),
  };
}

function routeCompatible({ connections, pathConnectionIds, requirements = [] }) {
  const byId = new Map((connections || []).map((connection) => [String(connection._id), connection]));
  return (pathConnectionIds || []).every((id) => {
    const connection = byId.get(String(id));
    return connection && edgeCompatible(connection, requirements);
  });
}

module.exports = { evaluateRequirement, edgeCompatible, preferencePenalty, pacePreferenceToSpeed, estimateConnectionSeconds, resolveRoute, routeCompatible };
