const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../config/adaptivePolicy");
const {
  edgeCompatible,
  pacePreferenceToSpeed,
  estimateConnectionSeconds,
  resolveRoute,
  resolvePlannedPath,
} = require("../services/graphRouting.service");
const {
  robustMedian,
  confidenceFromSamples,
  computeTransitionReliability,
  computeObservationReliability,
  summarizeSession,
} = require("../services/adaptiveLearning.service");
const {
  fallbackPaceFactor,
  resolveMovementBaseline,
  resolvePaceFactor,
} = require("../services/adaptiveEstimation.service");

function connection(id, from, to, distanceMeters, attributes = {}, extra = {}) {
  return { _id: id, fromPlaceId: from, toPlaceId: to, distanceMeters, attributes, directionality: "bidirectional", additionalDelaySeconds: 0, instructions: {}, ...extra };
}

test("required routing constraints exclude incompatible edges", () => {
  const connections = [connection("stairs", "A", "B", 5, { step_free: false }), connection("ramp1", "A", "C", 8, { step_free: true }), connection("ramp2", "C", "B", 8, { step_free: true })];
  const result = resolveRoute({ connections, fromPlaceId: "A", toPlaceId: "B", speedMps: 1, requirements: [{ attributeKey: "step_free", operator: "eq", value: true, priority: "required" }] });
  assert.equal(result.reachable, true);
  assert.deepEqual(result.path.map((entry) => String(entry.connectionId)), ["ramp1", "ramp2"]);
});

test("planned route must be topologically continuous and respect requirements", () => {
  const connections = [connection("ab", "A", "B", 5, { step_free: true }), connection("cd", "C", "D", 5, { step_free: true })];
  const result = resolvePlannedPath({ connections, pathConnectionIds: ["ab", "cd"], fromPlaceId: "A", toPlaceId: "D", requirements: [{ attributeKey: "step_free", operator: "eq", value: true, priority: "required" }] });
  assert.equal(result.reachable, false);
});

test("preferred path is chosen only within relative detour tolerance", () => {
  const preference = [{ attributeKey: "tactile_guidance", operator: "eq", value: true, priority: "preferred", weight: 1 }];
  const reasonable = resolveRoute({
    connections: [connection("direct", "A", "B", 100, { tactile_guidance: false }), connection("guided1", "A", "C", 60, { tactile_guidance: true }), connection("guided2", "C", "B", 60, { tactile_guidance: true })],
    fromPlaceId: "A", toPlaceId: "B", speedMps: 1, requirements: preference,
  });
  assert.deepEqual(reasonable.path.map((entry) => String(entry.connectionId)), ["guided1", "guided2"]);
  const excessive = resolveRoute({
    connections: [connection("direct", "A", "B", 100, { tactile_guidance: false }), connection("guided1", "A", "C", 80, { tactile_guidance: true }), connection("guided2", "C", "B", 80, { tactile_guidance: true })],
    fromPlaceId: "A", toPlaceId: "B", speedMps: 1, requirements: preference,
  });
  assert.deepEqual(excessive.path.map((entry) => String(entry.connectionId)), ["direct"]);
  assert.equal(policy.routing.maxPreferredDetourRatio, 0.35);
});

test("movement pace is relative to the supplied baseline", () => {
  const baseline = 0.8;
  assert.equal(pacePreferenceToSpeed(0.5, { baselineSpeedMps: baseline }), baseline);
  assert.ok(pacePreferenceToSpeed(0, { baselineSpeedMps: baseline }) < baseline);
  assert.ok(pacePreferenceToSpeed(1, { baselineSpeedMps: baseline }) > baseline);
  assert.equal(fallbackPaceFactor(0.5), 1);
});

test("learned personal baseline and pace factor remain separate", () => {
  const userProfile = { movement: { estimatedSpeedMps: { value: 0.75, confidence: 0.8 } } };
  const globalProfile = { movementSpeedMps: { value: 1, confidence: 0.8 }, paceFactors: { fast: { value: 1.25, confidence: 0.8 } } };
  const baseline = resolveMovementBaseline({ userProfile, globalProfile });
  const pace = resolvePaceFactor({ preference: 1, globalProfile });
  assert.ok(baseline < 1);
  assert.ok(pace > 1);
});

test("connection estimate separates movement, fixed delay and learned residual", () => {
  const edge = connection("x", "A", "B", 20, {}, { additionalDelaySeconds: 10 });
  assert.equal(estimateConnectionSeconds(edge, { speedMps: 1, learnedResidualSeconds: 5 }), 35);
});

test("robust median resists a single long pause", () => {
  assert.equal(robustMedian([40, 42, 41, 600, 39]), 41);
});

test("collective confidence values contributors, not only samples", () => {
  assert.ok(confidenceFromSamples(100, 20) > confidenceFromSamples(100, 1));
});

test("implausible transition observations receive low reliability", () => {
  assert.ok(computeTransitionReliability({ distanceMeters: 20, predictedSeconds: 20, observedSeconds: 600 }) < 0.5);
});

test("invalid stop timing is not trusted", () => {
  assert.equal(computeObservationReliability({ contentSeconds: 120, totalStopSeconds: 90, postContentObservationSeconds: 0 }), 0);
});

test("session summary learns delay-corrected movement and observation separately", () => {
  const summary = summarizeSession({
    transitionObservations: [
      { distanceMeters: 20, observedSeconds: 30, predictedSeconds: 30, observedMovementSpeedMps: 1, reliability: 1 },
      { distanceMeters: 30, observedSeconds: 40, predictedSeconds: 40, observedMovementSpeedMps: 1, reliability: 1 },
    ],
    stopObservations: [
      { contentSeconds: 100, totalStopSeconds: 150, postContentObservationSeconds: 50, reliability: 1 },
      { contentSeconds: 120, totalStopSeconds: 180, postContentObservationSeconds: 60, reliability: 1 },
    ],
  });
  assert.equal(summary.estimatedSpeedMps, 1);
  assert.equal(summary.typicalPostContentObservationSeconds, 55);
  assert.equal(summary.observedTotalSeconds, 400);
});
