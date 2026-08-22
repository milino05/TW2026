const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

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

test("a LayoutRevision maps each canonicalKey at most once", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    require("../models/venueTarget.model");
    const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
    const venueId = new mongoose.Types.ObjectId();
    const layoutId = new mongoose.Types.ObjectId();
    const issues = await computeVenueReleaseIssues({
      venue: { _id: venueId },
      release: { venueId, layoutRevisionId: layoutId, targetBindings: [] },
      layout: {
        _id: layoutId,
        venueId,
        placeTypes: [],
        routingAttributes: [
          { key: "steps_a", label: "Scale A", dataType: "boolean", appliesTo: "connection", canonicalKey: "stairs" },
          { key: "steps_b", label: "Scale B", dataType: "boolean", appliesTo: "connection", canonicalKey: "stairs" },
        ],
        routingPresets: [],
        floors: [],
        places: [],
        venueTargetPlacements: [],
        connections: [],
      },
    });
    assert.ok(issues.some((issue) => issue.code === "DUPLICATE_CANONICAL_ATTRIBUTE_MAPPING"));
  });
});
