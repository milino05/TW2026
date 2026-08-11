const test = require("node:test");
const assert = require("node:assert/strict");
const {
  edgeCompatible,
  pacePreferenceToSpeed,
  estimateConnectionSeconds,
  resolveRoute,
  routeCompatible,
} = require("../services/graphRouting.service");
const {
  robustMedian,
  computeTransitionReliability,
  computeObservationReliability,
  summarizeSession,
} = require("../services/adaptiveLearning.service");

function connection(id, from, to, distanceMeters, attributes = {}, extra = {}) {
  return {
    _id: id,
    fromPlaceId: from,
    toPlaceId: to,
    distanceMeters,
    attributes,
    directionality: "bidirectional",
    additionalDelaySeconds: 0,
    instructions: {},
    ...extra,
  };
}

test("required routing constraints exclude incompatible edges", () => {
  const connections = [
    connection("stairs", "A", "B", 5, { step_free: false }),
    connection("ramp1", "A", "C", 8, { step_free: true }),
    connection("ramp2", "C", "B", 8, { step_free: true }),
  ];
  const result = resolveRoute({
    connections,
    fromPlaceId: "A",
    toPlaceId: "B",
    speedMps: 1,
    requirements: [{ attributeKey: "step_free", operator: "eq", value: true, priority: "required" }],
  });
  assert.equal(result.reachable, true);
  assert.deepEqual(result.path.map((entry) => String(entry.connectionId)), ["ramp1", "ramp2"]);
});

test("planned route is rejected when a required constraint is violated", () => {
  const connections = [connection("stairs", "A", "B", 5, { step_free: false })];
  assert.equal(routeCompatible({
    connections,
    pathConnectionIds: ["stairs"],
    requirements: [{ attributeKey: "step_free", operator: "eq", value: true, priority: "required" }],
  }), false);
});

test("preferred requirements influence cost but never make an edge impossible", () => {
  const edge = connection("x", "A", "B", 5, { tactile_guidance: false });
  assert.equal(edgeCompatible(edge, [{ attributeKey: "tactile_guidance", value: true, priority: "preferred" }]), true);
});

test("movement pace preference maps monotonically to initial speed", () => {
  assert.ok(pacePreferenceToSpeed(0) < pacePreferenceToSpeed(0.5));
  assert.ok(pacePreferenceToSpeed(0.5) < pacePreferenceToSpeed(1));
});

test("connection estimate separates distance, fixed delay and learned residual", () => {
  const edge = connection("x", "A", "B", 20, {}, { additionalDelaySeconds: 10 });
  assert.equal(estimateConnectionSeconds(edge, { speedMps: 1, learnedResidualSeconds: 5, userCorrectionFactor: 1 }), 35);
});

test("robust median resists a single long pause", () => {
  assert.equal(robustMedian([40, 42, 41, 600, 39]), 41);
});

test("implausible transition observations receive low reliability", () => {
  const reliability = computeTransitionReliability({ distanceMeters: 20, predictedSeconds: 20, observedSeconds: 600 });
  assert.ok(reliability < 0.5);
});

test("invalid stop timing is not trusted", () => {
  assert.equal(computeObservationReliability({ contentSeconds: 120, totalStopSeconds: 90, postContentObservationSeconds: 0 }), 0);
});

test("session summary learns movement and post-content observation separately", () => {
  const summary = summarizeSession({
    transitionObservations: [
      { distanceMeters: 20, observedSeconds: 20, predictedSeconds: 22, reliability: 1 },
      { distanceMeters: 30, observedSeconds: 30, predictedSeconds: 33, reliability: 1 },
    ],
    stopObservations: [
      { contentSeconds: 100, totalStopSeconds: 150, postContentObservationSeconds: 50, reliability: 1 },
      { contentSeconds: 120, totalStopSeconds: 180, postContentObservationSeconds: 60, reliability: 1 },
    ],
  });
  assert.equal(summary.estimatedSpeedMps, 1);
  assert.equal(summary.typicalPostContentObservationSeconds, 55);
});
