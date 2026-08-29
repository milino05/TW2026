const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_venue_routing_integrity_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

function releaseFixture({ venueId, layoutId }) {
  return { venueId, layoutRevisionId: layoutId, targetBindings: [] };
}

test("VenueRelease integrity validates typed attributes against the pinned PhysicalVocabularyRevision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
    const userId = new mongoose.Types.ObjectId();
    const physical = await createPublishedPhysicalVocabulary({ userId });
    const venueId = new mongoose.Types.ObjectId();
    const layoutId = new mongoose.Types.ObjectId();
    const floorId = new mongoose.Types.ObjectId();
    const placeId = new mongoose.Types.ObjectId();
    const room = physical.placeTypeByKey.get("room");
    const quietArea = physical.physicalAttributeByKey.get("quiet_area");
    const issues = await computeVenueReleaseIssues({
      venue: { _id: venueId },
      release: releaseFixture({ venueId, layoutId }),
      layout: {
        _id: layoutId,
        venueId,
        authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
        floors: [{ _id: floorId, label: "Piano terra" }],
        places: [{
          _id: placeId,
          floorId,
          placeTypeDefinitionId: room.definitionId,
          position: { x: 0.5, y: 0.5 },
          attributeValues: [
            { physicalAttributeDefinitionId: quietArea.definitionId, value: true },
            { physicalAttributeDefinitionId: quietArea.definitionId, value: "si" },
          ],
        }],
        exhibitSlots: [],
        connections: [],
      },
    });
    assert.ok(issues.some((issue) => issue.code === "DUPLICATE_PHYSICAL_ATTRIBUTE_VALUE"));
    assert.ok(issues.some((issue) => issue.code === "ATTRIBUTE_VALUE_TYPE_MISMATCH"));
  });
});

test("geometry_derived uses Floor calibration and rejects a stale distance", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
    const userId = new mongoose.Types.ObjectId();
    const physical = await createPublishedPhysicalVocabulary({ userId });
    const venueId = new mongoose.Types.ObjectId();
    const layoutId = new mongoose.Types.ObjectId();
    const floorId = new mongoose.Types.ObjectId();
    const fromPlaceId = new mongoose.Types.ObjectId();
    const toPlaceId = new mongoose.Types.ObjectId();
    const room = physical.placeTypeByKey.get("room");
    const layout = {
      _id: layoutId,
      venueId,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{
        _id: floorId,
        label: "Piano terra",
        mapAsset: { url: "/maps/floor.png", mimeType: "image/png", width: 1000, height: 500 },
        calibration: {
          method: "line",
          distanceMeters: 100,
          metersPerPixel: 0.1,
          line: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
        },
      }],
      places: [
        { _id: fromPlaceId, floorId, placeTypeDefinitionId: room.definitionId, position: { x: 0.1, y: 0.5 }, attributeValues: [] },
        { _id: toPlaceId, floorId, placeTypeDefinitionId: room.definitionId, position: { x: 0.5, y: 0.5 }, attributeValues: [] },
      ],
      exhibitSlots: [],
      connections: [{
        _id: new mongoose.Types.ObjectId(),
        fromPlaceId,
        toPlaceId,
        directionality: "bidirectional",
        geometry: { points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }] },
        metricMode: "geometry_derived",
        distanceMeters: 39,
        attributeValues: [],
      }],
    };
    const issues = await computeVenueReleaseIssues({
      venue: { _id: venueId },
      release: releaseFixture({ venueId, layoutId }),
      layout,
    });
    assert.ok(issues.some((issue) => issue.code === "DERIVED_DISTANCE_MISMATCH"));

    layout.connections[0].distanceMeters = 40;
    const validIssues = await computeVenueReleaseIssues({
      venue: { _id: venueId },
      release: releaseFixture({ venueId, layoutId }),
      layout,
    });
    assert.deepEqual(validIssues, []);
  });
});
