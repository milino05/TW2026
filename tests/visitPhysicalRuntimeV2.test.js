const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  anchorLocationValue,
  resolveIndoorLiveRouteFromBundle,
  resolvePlannedInterVenueRoute,
  nextKnownLocationFromRoute,
  advancePhysicalProgressV2,
  returnToVisitV2,
} = require("../services/visitPhysicalRuntimeV2.service");

function oid() { return new mongoose.Types.ObjectId(); }

function fakeSession(values = {}) {
  return {
    ...values,
    saveCount: 0,
    async save() { this.saveCount += 1; return this; },
  };
}

function routingFixture() {
  const venueId = oid();
  const placeA = oid();
  const placeB = oid();
  const placeC = oid();
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
          _id: oid(),
          fromPlaceId: placeA,
          toPlaceId: placeB,
          directionality: "bidirectional",
          distanceMeters: 5,
          additionalDelaySeconds: 0,
          attributeValues: [],
          instructions: { forward: "Vai verso B", backward: "Torna verso A" },
        },
        {
          _id: oid(),
          fromPlaceId: placeB,
          toPlaceId: placeC,
          directionality: "bidirectional",
          distanceMeters: 4,
          additionalDelaySeconds: 0,
          attributeValues: [],
          instructions: { forward: "Vai verso C", backward: "Torna verso B" },
        },
      ],
    },
  };
  const routingSession = {
    navigationSnapshot: { routingProfileSelections: [], requirements: [], venueRequirements: [] },
    sessionMovementSpeedMps: 1,
  };
  return { venueId, placeA, placeB, placeC, bundle, routingSession };
}

test("manual selection of a visit stop confirms only its place, not the artwork", () => {
  const anchor = {
    _id: oid(),
    venueId: oid(),
    placeId: oid(),
    venueTargetId: oid(),
    exhibitSlotId: oid(),
  };
  const location = anchorLocationValue(anchor, { source: "manual_selection" });
  assert.equal(String(location.venueId), String(anchor.venueId));
  assert.equal(String(location.placeId), String(anchor.placeId));
  assert.equal(location.visitAnchorId, null);
  assert.equal(location.venueTargetId, null);
  assert.equal(location.exhibitSlotId, null);
});

test("an exact provider may resolve a visit stop to its anchor and exhibit slot", () => {
  const anchor = {
    _id: oid(),
    venueId: oid(),
    placeId: oid(),
    venueTargetId: oid(),
    exhibitSlotId: oid(),
  };
  const location = anchorLocationValue(anchor, { source: "qr", providerId: "public-code" });
  assert.equal(String(location.visitAnchorId), String(anchor._id));
  assert.equal(String(location.venueTargetId), String(anchor.venueTargetId));
  assert.equal(String(location.exhibitSlotId), String(anchor.exhibitSlotId));
  assert.equal(location.providerId, "public-code");
});

test("live indoor routing riusa il grafo esistente e restituisce edge confermabili", () => {
  const value = routingFixture();
  const route = resolveIndoorLiveRouteFromBundle({
    routingSession: value.routingSession,
    bundle: value.bundle,
    fromPlaceId: value.placeA,
    toPlaceId: value.placeC,
  });
  assert.equal(route.type, "indoor");
  assert.equal(route.path.length, 2);
  assert.equal(route.path[0].fromPlaceId, String(value.placeA));
  assert.equal(route.path[0].toPlaceId, String(value.placeB));
  assert.equal(route.path[1].toPlaceId, String(value.placeC));
  assert.equal(route.distanceMeters, 9);
});

test("live indoor routing espone un errore stabile quando la destinazione non è raggiungibile", () => {
  const value = routingFixture();
  value.bundle.layout.connections = [];
  assert.throws(() => resolveIndoorLiveRouteFromBundle({
    routingSession: value.routingSession,
    bundle: value.bundle,
    fromPlaceId: value.placeA,
    toPlaceId: value.placeC,
  }), (error) => error?.details?.[0]?.code === "LIVE_ROUTE_UNREACHABLE");
});

test("la conferma di un passo indoor aggiorna solo la KnownLocation al prossimo place", () => {
  const value = routingFixture();
  const route = resolveIndoorLiveRouteFromBundle({
    routingSession: value.routingSession,
    bundle: value.bundle,
    fromPlaceId: value.placeA,
    toPlaceId: value.placeC,
  });
  const location = nextKnownLocationFromRoute(route, { observedAt: new Date("2026-09-14T12:00:00.000Z") });
  assert.equal(String(location.venueId), String(value.venueId));
  assert.equal(String(location.placeId), String(value.placeB));
  assert.equal(location.visitAnchorId, null);
  assert.equal(location.source, "navigation_confirmation");
});

test("un trasferimento inter-Venue usa soltanto una leg pianificata nella direzione prevista", () => {
  const fromAnchorId = oid();
  const toAnchorId = oid();
  const fromVenueId = oid();
  const toVenueId = oid();
  const sourcePlaceId = oid();
  const destinationPlaceId = oid();
  const plan = {
    visitAnchors: [
      { _id: fromAnchorId, venueId: fromVenueId, placeId: sourcePlaceId },
      { _id: toAnchorId, venueId: toVenueId, placeId: destinationPlaceId },
    ],
    physicalRoute: {
      legs: [{
        type: "inter_venue",
        fromAnchorId,
        toAnchorId,
        estimatedSeconds: 600,
        instruction: "Raggiungi la seconda sede",
      }],
    },
  };
  const destinationAnchor = { _id: toAnchorId, venueId: toVenueId, placeId: destinationPlaceId };
  const route = resolvePlannedInterVenueRoute({
    plan,
    knownLocation: { venueId: fromVenueId, placeId: sourcePlaceId, visitAnchorId: fromAnchorId },
    destinationAnchor,
  });
  assert.equal(route.type, "inter_venue");
  assert.equal(route.transferInstruction, "Raggiungi la seconda sede");
  const location = nextKnownLocationFromRoute(route);
  assert.equal(String(location.venueId), String(toVenueId));
  assert.equal(String(location.placeId), String(destinationPlaceId));
  assert.equal(location.visitAnchorId, null);

  const placeLevelRoute = resolvePlannedInterVenueRoute({
    plan,
    knownLocation: { venueId: fromVenueId, placeId: sourcePlaceId, visitAnchorId: null },
    destinationAnchor,
  });
  assert.equal(placeLevelRoute.type, "inter_venue");
  assert.equal(String(placeLevelRoute.fromVisitAnchorId), String(fromAnchorId));

  assert.throws(() => resolvePlannedInterVenueRoute({
    plan,
    knownLocation: { venueId: fromVenueId, placeId: oid(), visitAnchorId: null },
    destinationAnchor,
  }), (error) => error?.details?.[0]?.code === "LIVE_INTER_VENUE_ROUTE_UNAVAILABLE");
});

test("approach confirmation soddisfa l'anchor senza avanzare il cursore narrativo", async () => {
  const venueId = oid();
  const placeId = oid();
  const anchorId = oid();
  const slotId = oid();
  const targetId = oid();
  const entryId = oid();
  const personalSession = fakeSession({
    currentEntryIndex: 0,
    status: "active",
    physicalRuntime: {
      knownLocation: {
        venueId,
        placeId,
        visitAnchorId: null,
        venueTargetId: null,
        exhibitSlotId: null,
        source: "manual_selection",
      },
      detour: null,
    },
  });
  const plan = {
    contentEntries: [{ _id: entryId, deliveryAnchorId: anchorId }],
    visitAnchors: [{ _id: anchorId, venueId, placeId, exhibitSlotId: slotId, venueTargetId: targetId }],
  };
  const result = await advancePhysicalProgressV2({
    personalSession,
    routingSession: {},
    plan,
    currentEntryIndex: 0,
  });
  assert.equal(result.type, "approach_confirmed");
  assert.equal(String(personalSession.physicalRuntime.knownLocation.visitAnchorId), String(anchorId));
  assert.equal(String(personalSession.physicalRuntime.knownLocation.exhibitSlotId), String(slotId));
  assert.equal(personalSession.currentEntryIndex, 0);
  assert.equal(personalSession.saveCount, 1);
});

test("Torna alla visita elimina solo la deviazione e preserva posizione e cursore", async () => {
  const knownLocation = {
    venueId: oid(),
    placeId: oid(),
    source: "navigation_confirmation",
  };
  const personalSession = fakeSession({
    currentEntryIndex: 5,
    physicalRuntime: {
      knownLocation,
      detour: {
        destination: { venueId: knownLocation.venueId, placeId: oid(), physicalFeatureRef: null },
        startedAt: new Date(),
      },
    },
  });
  await returnToVisitV2({ personalSession });
  assert.equal(personalSession.physicalRuntime.detour, null);
  assert.equal(personalSession.physicalRuntime.knownLocation, knownLocation);
  assert.equal(personalSession.currentEntryIndex, 5);
  assert.equal(personalSession.saveCount, 1);
});