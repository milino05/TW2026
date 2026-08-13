const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeInterests, remainingSeconds, segmentEndForMuseum } = require("../services/planAdaptation.service");
const { normalizeVisitPayload, validateVisitDraftPayload } = require("../services/validation/visit.validation");

const id = (value) => value.toString(16).padStart(24, "0").slice(-24);

test("runtime interests can be added or explicitly replaced", () => {
  const base = [{ kind: "tag", key: "history", weight: 0.4 }];
  const added = mergeInterests(base, [{ kind: "tag", key: "history", weight: 1 }, { kind: "tag", key: "technique", weight: 0.7 }]);
  assert.deepEqual(added, [{ kind: "tag", key: "history", weight: 1 }, { kind: "tag", key: "technique", weight: 0.7 }]);
  assert.deepEqual(mergeInterests(base, [{ kind: "tag", key: "technique", weight: 1 }], true), [{ kind: "tag", key: "technique", weight: 1 }]);
});

test("remainingSeconds ignores the immutable executed prefix", () => {
  const plan = { stops: [{ estimatedContentSeconds: 10, estimatedObservationSeconds: 5 }, { estimatedContentSeconds: 20, estimatedObservationSeconds: 5 }, { estimatedContentSeconds: 30, estimatedObservationSeconds: 5 }], transitions: [{ fromStopIndex: 0, toStopIndex: 1, estimatedSeconds: 4 }, { fromStopIndex: 1, toStopIndex: 2, estimatedSeconds: 6 }] };
  assert.equal(remainingSeconds(plan, 0), 20 + 5 + 30 + 5 + 4 + 6);
  assert.equal(remainingSeconds(plan, 1), 30 + 5 + 6);
});

test("multi museum replanning is scoped to the current museum segment", () => {
  const a = id(1), b = id(2);
  assert.equal(segmentEndForMuseum([{ museumId: a }, { museumId: a }, { museumId: b }, { museumId: b }], 0), 1);
  assert.equal(segmentEndForMuseum([{ museumId: a }, { museumId: a }, { museumId: b }, { museumId: b }], 2), 3);
});

test("visit stops use core recommended optional and reject the removed optional flag", () => {
  const payload = normalizeVisitPayload({ kind: "community", title: "Test", stops: [{ itemId: id(1), role: "core" }, { itemId: id(2), optional: true }] });
  const errors = validateVisitDraftPayload({ payload, kind: "community", mode: "create" });
  assert.equal(payload.stops[0].role, "core");
  assert.equal(errors.some((error) => error.code === "REMOVED_FIELD"), true);
});
