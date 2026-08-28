const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  isFreshLocationObservation,
  logicalAnchorForIndex,
  resolveNavigationOrigin,
} = require("../services/navigationOriginV2.service");

function fixture() {
  const anchorId = new mongoose.Types.ObjectId();
  const venueId = new mongoose.Types.ObjectId();
  const placeId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  return {
    session: { currentEntryIndex: 0 },
    plan: {
      contentEntries: [{ deliveryAnchorId: anchorId }],
      visitAnchors: [{ _id: anchorId, venueId, placeId, venueTargetId: targetId }],
    },
    anchorId,
    venueId,
    placeId,
    targetId,
  };
}

test("18-24 navigation origin falls back to the logical VisitAnchor", () => {
  const value = fixture();
  assert.equal(String(logicalAnchorForIndex(value.plan, 0)._id), String(value.anchorId));
  const origin = resolveNavigationOrigin({ session: value.session, plan: value.plan });
  assert.equal(origin.provenance, "logical_anchor");
  assert.equal(String(origin.venueId), String(value.venueId));
  assert.equal(String(origin.placeId), String(value.placeId));
});

test("explicit and fresh physical origins outrank logical fallback without changing visit progress", () => {
  const value = fixture();
  const now = new Date("2026-08-28T12:00:00.000Z");
  const observedVenueId = new mongoose.Types.ObjectId();
  const observedPlaceId = new mongoose.Types.ObjectId();
  const observation = {
    providerId: "qr",
    observedAt: "2026-08-28T11:59:50.000Z",
    location: { venueId: observedVenueId, placeId: observedPlaceId },
  };
  assert.equal(isFreshLocationObservation(observation, { now }), true);
  const physical = resolveNavigationOrigin({
    session: value.session,
    plan: value.plan,
    locationObservation: observation,
    now,
  });
  assert.equal(physical.provenance, "physical_observation");
  assert.equal(String(physical.placeId), String(observedPlaceId));
  assert.equal(value.session.currentEntryIndex, 0);

  const explicitVenueId = new mongoose.Types.ObjectId();
  const explicitPlaceId = new mongoose.Types.ObjectId();
  const explicit = resolveNavigationOrigin({
    session: value.session,
    plan: value.plan,
    explicitOrigin: { venueId: explicitVenueId, placeId: explicitPlaceId },
    locationObservation: observation,
    now,
  });
  assert.equal(explicit.provenance, "explicit");
  assert.equal(String(explicit.placeId), String(explicitPlaceId));
});

test("stale, future and malformed observations never override the logical anchor", () => {
  const value = fixture();
  const now = new Date("2026-08-28T12:00:00.000Z");
  const location = { venueId: new mongoose.Types.ObjectId(), placeId: new mongoose.Types.ObjectId() };
  for (const observedAt of ["2026-08-28T11:58:00.000Z", "2026-08-28T12:00:01.000Z", "not-a-date"]) {
    const origin = resolveNavigationOrigin({
      session: value.session,
      plan: value.plan,
      locationObservation: { providerId: "test", observedAt, location },
      now,
    });
    assert.equal(origin.provenance, "logical_anchor");
    assert.equal(String(origin.placeId), String(value.placeId));
  }
});
