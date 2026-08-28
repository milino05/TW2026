const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const LayoutRevision = require("../models/layoutRevision.model");
const {
  deriveMetersPerPixel,
  distanceMetersForGeometry,
} = require("../services/layoutGeometry.service");
const {
  normalizeWorkingVenueReleasePayload,
  validateWorkingVenueReleasePayload,
} = require("../services/validation/venueRelease.validation");

function oid() { return new mongoose.Types.ObjectId(); }

test("LayoutRevision pins a PhysicalVocabularyRevision and contains no embedded vocabulary", async () => {
  const floorId = oid();
  const layout = new LayoutRevision({
    venueId: oid(),
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: oid(),
    floors: [{ _id: floorId, label: "Piano terra" }],
    places: [{ floorId, placeTypeDefinitionId: "room-definition", position: { x: 0.25, y: 0.5 } }],
    placeTypes: [{ key: "legacy" }],
    routingAttributes: [{ key: "legacy" }],
    routingPresets: [{ key: "legacy" }],
    createdBy: oid(),
    updatedBy: oid(),
  });
  await layout.validate();
  assert.ok(layout.authoredAgainstPhysicalVocabularyRevisionId);
  assert.equal(layout.placeTypes, undefined);
  assert.equal(layout.routingAttributes, undefined);
  assert.equal(layout.routingPresets, undefined);
});

test("VenueRelease update contract rejects legacy Layout vocabulary fields", () => {
  const rawPayload = { layout: { placeTypes: [], routingAttributes: [], routingPresets: [] } };
  const issues = validateWorkingVenueReleasePayload({
    payload: normalizeWorkingVenueReleasePayload(rawPayload),
    rawPayload,
  });
  assert.deepEqual(issues.map((entry) => entry.field), [
    "layout.placeTypes",
    "layout.routingAttributes",
    "layout.routingPresets",
  ]);
});

test("Floor calibration converts normalized polyline geometry into meters", () => {
  const floor = {
    mapAsset: { width: 1000, height: 500 },
    calibration: { metersPerPixel: 0.1 },
  };
  assert.equal(deriveMetersPerPixel({
    distanceMeters: 100,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    mapAsset: floor.mapAsset,
  }), 0.1);
  assert.equal(distanceMetersForGeometry({
    points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }],
    floor,
  }), 40);
});
