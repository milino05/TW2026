const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
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
  const observedVenueId = new mongoose.Types.ObjectId();
  const observedPlaceId = new mongoose.Types.ObjectId();
  const physical = resolveNavigationOrigin({
    session: value.session,
    plan: value.plan,
    locationObservation: { venueId: observedVenueId, placeId: observedPlaceId, isFresh: true },
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
    locationObservation: { venueId: observedVenueId, placeId: observedPlaceId, isFresh: true },
  });
  assert.equal(explicit.provenance, "explicit");
  assert.equal(String(explicit.placeId), String(explicitPlaceId));
});
