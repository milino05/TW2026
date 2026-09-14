const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  EXECUTION_PHASES,
  deliveryAnchorForIndex,
  contextAnchorForIndex,
  deriveVisitExecutionState,
} = require("../services/visitExecutionRuntimeV2.service");

function oid() { return new mongoose.Types.ObjectId(); }

function fixture() {
  const venueId = oid();
  const roomA = oid();
  const roomB = oid();
  const firstSlot = oid();
  const secondSlot = oid();
  const firstAnchorId = oid();
  const secondAnchorId = oid();
  const firstEntryId = oid();
  const contextualEntryId = oid();
  const secondEntryId = oid();
  const plan = {
    visitAnchors: [
      { _id: firstAnchorId, venueId, placeId: roomA, exhibitSlotId: firstSlot, venueTargetId: oid() },
      { _id: secondAnchorId, venueId, placeId: roomB, exhibitSlotId: secondSlot, venueTargetId: oid() },
    ],
    contentEntries: [
      { _id: firstEntryId, deliveryAnchorId: firstAnchorId },
      { _id: contextualEntryId, deliveryAnchorId: firstAnchorId },
      { _id: secondEntryId, deliveryAnchorId: secondAnchorId },
    ],
  };
  return {
    venueId,
    roomA,
    roomB,
    firstSlot,
    secondSlot,
    firstAnchorId,
    secondAnchorId,
    firstEntryId,
    contextualEntryId,
    secondEntryId,
    plan,
  };
}

function session(physicalRuntime = {}, extra = {}) {
  return {
    status: "active",
    physicalRuntime: { knownLocation: null, detour: null, ...physicalRuntime },
    semanticPresentation: null,
    ...extra,
  };
}

test("delivery anchor and context anchor remain distinct concepts", () => {
  const value = fixture();
  const independentEntry = { _id: oid(), deliveryAnchorId: null };
  value.plan.contentEntries.splice(2, 0, independentEntry);
  assert.equal(String(deliveryAnchorForIndex(value.plan, 2)), "null");
  assert.equal(String(contextAnchorForIndex(value.plan, 2)._id), String(value.firstAnchorId));
});

test("a session with physical stops requires an explicit known location before delivery", () => {
  const value = fixture();
  const runtime = deriveVisitExecutionState({ personalSession: session(), plan: value.plan, currentEntryIndex: 0 });
  assert.equal(runtime.phase, EXECUTION_PHASES.LOCATION_REQUIRED);
  assert.equal(runtime.presentationAvailable, false);
});

test("location-independent content can be delivered when the plan has no physical stops", () => {
  const entry = { _id: oid(), deliveryAnchorId: null };
  const runtime = deriveVisitExecutionState({
    personalSession: session(),
    plan: { visitAnchors: [], contentEntries: [entry] },
    currentEntryIndex: 0,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.PRESENTING_VISIT_CONTENT);
  assert.equal(runtime.presentationAvailable, true);
});

test("being in the target room enters approach without claiming the exhibit was found", () => {
  const value = fixture();
  const runtime = deriveVisitExecutionState({
    personalSession: session({ knownLocation: { venueId: value.venueId, placeId: value.roomA } }),
    plan: value.plan,
    currentEntryIndex: 0,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.APPROACHING_VISIT_TARGET);
  assert.equal(runtime.presentationAvailable, false);
});

test("confirming the exact visit anchor unlocks the current representation", () => {
  const value = fixture();
  const runtime = deriveVisitExecutionState({
    personalSession: session({
      knownLocation: {
        venueId: value.venueId,
        placeId: value.roomA,
        visitAnchorId: value.firstAnchorId,
        exhibitSlotId: value.firstSlot,
      },
    }),
    plan: value.plan,
    currentEntryIndex: 1,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.PRESENTING_VISIT_CONTENT);
  assert.equal(runtime.presentationAvailable, true);
});

test("moving the narrative cursor to another room derives navigation without moving the known location", () => {
  const value = fixture();
  const knownLocation = {
    venueId: value.venueId,
    placeId: value.roomA,
    visitAnchorId: value.firstAnchorId,
    exhibitSlotId: value.firstSlot,
  };
  const runtime = deriveVisitExecutionState({
    personalSession: session({ knownLocation }),
    plan: value.plan,
    currentEntryIndex: 2,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP);
  assert.equal(runtime.knownLocation, knownLocation);
  assert.equal(String(runtime.deliveryAnchor._id), String(value.secondAnchorId));
});

test("an active detour overrides visit delivery while preserving the narrative entry", () => {
  const value = fixture();
  const toiletPlaceId = oid();
  const runtime = deriveVisitExecutionState({
    personalSession: session({
      knownLocation: { venueId: value.venueId, placeId: value.roomA },
      detour: { destination: { venueId: value.venueId, placeId: toiletPlaceId } },
    }),
    plan: value.plan,
    currentEntryIndex: 0,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.NAVIGATING_DETOUR);
  assert.equal(String(runtime.entry._id), String(value.firstEntryId));
});

test("reaching the detour destination does not advance visit content", () => {
  const value = fixture();
  const toiletPlaceId = oid();
  const runtime = deriveVisitExecutionState({
    personalSession: session({
      knownLocation: { venueId: value.venueId, placeId: toiletPlaceId },
      detour: { destination: { venueId: value.venueId, placeId: toiletPlaceId } },
    }),
    plan: value.plan,
    currentEntryIndex: 0,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.AT_DETOUR_DESTINATION);
  assert.equal(String(runtime.entry._id), String(value.firstEntryId));
});

test("semantic presentation remains a personal presentation phase for its source entry", () => {
  const value = fixture();
  const runtime = deriveVisitExecutionState({
    personalSession: session({
      knownLocation: {
        venueId: value.venueId,
        placeId: value.roomA,
        visitAnchorId: value.firstAnchorId,
      },
    }, {
      semanticPresentation: { sourceContentEntryId: value.firstEntryId },
    }),
    plan: value.plan,
    currentEntryIndex: 0,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.PRESENTING_SEMANTIC_CONTENT);
  assert.equal(runtime.presentationAvailable, true);
});

test("route-completed lifecycle remains orthogonal to physical state", () => {
  const value = fixture();
  const runtime = deriveVisitExecutionState({
    personalSession: session({ knownLocation: { venueId: value.venueId, placeId: value.roomA } }, { status: "route_completed" }),
    plan: value.plan,
    currentEntryIndex: 2,
  });
  assert.equal(runtime.phase, EXECUTION_PHASES.ROUTE_COMPLETED);
  assert.equal(runtime.presentationAvailable, false);
});
