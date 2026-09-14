const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  EXECUTION_PHASES,
  deriveVisitExecutionState,
} = require("../services/visitExecutionRuntimeV2.service");
const {
  knownLocationValue,
  confirmedAnchorLocation,
  resolveIndoorLiveRouteFromBundle,
  nextKnownLocationFromRoute,
} = require("../services/visitPhysicalRuntimeV2.service");
const {
  visitStopIndex,
  synchronizedPlaybackOverridesPhysicalGate,
} = require("../services/navigatorRuntimeV2.service");
const { annotateStops } = require("../services/navigatorMapProjectionV2.service");

function oid() { return new mongoose.Types.ObjectId(); }
function id(value) { return String(value?._id || value || ""); }

function indoorFixture() {
  const venueId = oid();
  const placeA = oid();
  const placeB = oid();
  const placeC = oid();
  const anchorId = oid();
  const entryId = oid();
  const target = {
    _id: anchorId,
    venueId,
    placeId: placeC,
    exhibitSlotId: oid(),
    venueTargetId: oid(),
  };
  const plan = {
    contentEntries: [{ _id: entryId, deliveryAnchorId: anchorId }],
    visitAnchors: [target],
  };
  const routingSession = {
    navigationSnapshot: { routingProfileSelections: [], requirements: [], venueRequirements: [] },
    sessionMovementSpeedMps: 1,
  };
  const bundle = {
    pin: { venueId },
    physicalVocabulary: { _id: oid() },
    physicalVocabularyRevision: { physicalAttributes: [], routingProfiles: [] },
    layout: {
      places: [
        { _id: placeA, position: { x: 0.1, y: 0.1 }, attributeValues: [] },
        { _id: placeB, position: { x: 0.5, y: 0.1 }, attributeValues: [] },
        { _id: placeC, position: { x: 0.9, y: 0.1 }, attributeValues: [] },
      ],
      connections: [
        {
          _id: oid(), fromPlaceId: placeA, toPlaceId: placeB,
          directionality: "bidirectional", distanceMeters: 4, additionalDelaySeconds: 0,
          attributeValues: [], instructions: { forward: "Verso B", backward: "Verso A" },
        },
        {
          _id: oid(), fromPlaceId: placeB, toPlaceId: placeC,
          directionality: "bidirectional", distanceMeters: 5, additionalDelaySeconds: 0,
          attributeValues: [], instructions: { forward: "Verso C", backward: "Verso B" },
        },
      ],
    },
  };
  return { venueId, placeA, placeB, placeC, target, entryId, plan, routingSession, bundle };
}

test("start -> location -> navigation -> approach -> content never advances the narrative cursor", () => {
  const value = indoorFixture();
  const personalSession = {
    status: "active",
    currentEntryIndex: 0,
    semanticPresentation: null,
    physicalRuntime: { knownLocation: null, detour: null },
  };

  let execution = deriveVisitExecutionState({ personalSession, plan: value.plan, currentEntryIndex: 0 });
  assert.equal(execution.phase, EXECUTION_PHASES.LOCATION_REQUIRED);
  assert.equal(personalSession.currentEntryIndex, 0);

  personalSession.physicalRuntime.knownLocation = knownLocationValue({
    venueId: value.venueId,
    placeId: value.placeA,
    source: "manual_selection",
  });
  execution = deriveVisitExecutionState({ personalSession, plan: value.plan, currentEntryIndex: 0 });
  assert.equal(execution.phase, EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP);

  let route = resolveIndoorLiveRouteFromBundle({
    routingSession: value.routingSession,
    bundle: value.bundle,
    fromPlaceId: personalSession.physicalRuntime.knownLocation.placeId,
    toPlaceId: value.placeC,
  });
  personalSession.physicalRuntime.knownLocation = nextKnownLocationFromRoute(route);
  assert.equal(id(personalSession.physicalRuntime.knownLocation.placeId), id(value.placeB));
  assert.equal(personalSession.currentEntryIndex, 0);

  route = resolveIndoorLiveRouteFromBundle({
    routingSession: value.routingSession,
    bundle: value.bundle,
    fromPlaceId: personalSession.physicalRuntime.knownLocation.placeId,
    toPlaceId: value.placeC,
  });
  personalSession.physicalRuntime.knownLocation = nextKnownLocationFromRoute(route);
  execution = deriveVisitExecutionState({ personalSession, plan: value.plan, currentEntryIndex: 0 });
  assert.equal(execution.phase, EXECUTION_PHASES.APPROACHING_VISIT_TARGET);
  assert.equal(personalSession.currentEntryIndex, 0);

  personalSession.physicalRuntime.knownLocation = confirmedAnchorLocation(value.target);
  execution = deriveVisitExecutionState({ personalSession, plan: value.plan, currentEntryIndex: 0 });
  assert.equal(execution.phase, EXECUTION_PHASES.PRESENTING_VISIT_CONTENT);
  assert.equal(execution.presentationAvailable, true);
  assert.equal(personalSession.currentEntryIndex, 0);
});

test("selecting stop 3 restarts its content group and normal order continues through 4 and 5", () => {
  const anchors = Array.from({ length: 6 }, () => ({ _id: oid() }));
  const plan = {
    visitAnchors: anchors,
    contentEntries: [
      { _id: oid(), deliveryAnchorId: anchors[0]._id },
      { _id: oid(), deliveryAnchorId: anchors[1]._id },
      { _id: oid(), deliveryAnchorId: anchors[2]._id },
      { _id: oid(), deliveryAnchorId: anchors[2]._id },
      { _id: oid(), deliveryAnchorId: anchors[3]._id },
      { _id: oid(), deliveryAnchorId: anchors[4]._id },
      { _id: oid(), deliveryAnchorId: anchors[5]._id },
    ],
  };
  const index = visitStopIndex(plan, anchors[2]._id);
  assert.equal(index, 2);
  const futureStops = [];
  for (const entry of plan.contentEntries.slice(index)) {
    const anchorId = id(entry.deliveryAnchorId);
    if (futureStops.at(-1) !== anchorId) futureStops.push(anchorId);
  }
  assert.deepEqual(futureStops.slice(0, 4), [
    id(anchors[2]._id),
    id(anchors[3]._id),
    id(anchors[4]._id),
    id(anchors[5]._id),
  ]);
});

test("history is independent from cursor: stop 5 may be future and already experienced", () => {
  const anchors = Array.from({ length: 5 }, (_, index) => ({ _id: oid(), order: index + 1 }));
  const entries = anchors.map((anchor) => ({ _id: oid(), deliveryAnchorId: anchor._id }));
  const baseMap = {
    venues: [{
      id: oid(),
      stops: anchors.map((anchor, index) => ({ visitAnchorId: anchor._id, order: index + 1 })),
      route: { overlays: [], floorTransitions: [] },
    }],
  };
  const personalSession = {
    contentEntryExperiences: [{ contentEntryId: entries[4]._id, completionRatio: 1 }],
  };
  const [venue] = annotateStops({
    baseMap,
    personalSession,
    plan: { visitAnchors: anchors, contentEntries: entries },
    currentAnchor: anchors[2],
  });
  const stop3 = venue.stops[2];
  const stop5 = venue.stops[4];
  assert.equal(stop3.sequencePosition, "current");
  assert.equal(stop5.sequencePosition, "after_current");
  assert.equal(stop5.experienced, true);
});

test("shared playback can override only the current shared entry physical gate", () => {
  const entry = { _id: oid() };
  const otherEntry = { _id: oid() };
  assert.equal(synchronizedPlaybackOverridesPhysicalGate({
    synchronizedSession: { playback: { state: "playing", contentEntryId: entry._id } },
    entry,
  }), true);
  assert.equal(synchronizedPlaybackOverridesPhysicalGate({
    synchronizedSession: { playback: { state: "playing", contentEntryId: otherEntry._id } },
    entry,
  }), false);
  assert.equal(synchronizedPlaybackOverridesPhysicalGate({
    synchronizedSession: { playback: { state: "idle", contentEntryId: entry._id } },
    entry,
  }), false);
});