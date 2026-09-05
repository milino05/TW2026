const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
const User = require("../models/user");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const { WORKS, seedVisitAuthoringPlayground } = require("../scripts/seedVisitAuthoringPlayground");
const { getVenueManagementProjection } = require("../services/marketplaceManagementV2.service");
const { assessPreparedMapReadiness } = require("../services/navigationProjectionV2.service");

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

test("visit authoring playground crea cinque tappe pubblicate, una mappa ed è idempotente", { skip: !mongoUri }, async () => {
  const floorPlanRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-visit-ui-map-"));
  try {
    await withFreshDatabase(async () => {
      const actor = await User.create({ username: "visit-ui-test", passwordHash: "test-hash" });

      const first = await seedVisitAuthoringPlayground({ username: "visit-ui-test", floorPlanRoot });
      const second = await seedVisitAuthoringPlayground({ username: "visit-ui-test", floorPlanRoot });

      assert.equal(String(first.organization._id), String(second.organization._id));
      assert.equal(String(first.venue._id), String(second.venue._id));
      assert.equal(first.mapAsset.url, second.mapAsset.url);
      assert.equal(first.stops.length, 5);
      assert.equal(await VenueTarget.countDocuments({ venueId: first.venue._id, lifecycleStatus: "active" }), 5);

      const release = await VenueRelease.findById(first.venue.publishedReleaseId).lean();
      assert.ok(release);
      assert.equal(release.status, "published");
      assert.equal(release.integrity.status, "valid");
      assert.equal(release.targetBindings.length, 5);

      const layout = await LayoutRevision.findById(release.layoutRevisionId).lean();
      assert.ok(layout);
      assert.equal(layout.floors.length, 1);
      assert.equal(layout.floors[0].label, "Piano terra");
      assert.equal(layout.floors[0].mapAsset.url, first.mapAsset.url);
      assert.equal(layout.floors[0].mapAsset.mimeType, "image/png");
      assert.equal(layout.floors[0].mapAsset.width, 1000);
      assert.equal(layout.floors[0].mapAsset.height, 300);

      const mapFile = path.join(floorPlanRoot, path.basename(first.mapAsset.url));
      const mapBytes = await fs.readFile(mapFile);
      assert.deepEqual([...mapBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal((await fs.readdir(floorPlanRoot)).length, 1);

      const readiness = await assessPreparedMapReadiness({
        plan: {
          visitAnchors: [{
            _id: new mongoose.Types.ObjectId(),
            venueId: first.venue._id,
            placeId: layout.places[0]._id,
          }],
          physicalRoute: { legs: [] },
        },
        venuePins: [{
          venueId: first.venue._id,
          venueReleaseId: release._id,
          layoutRevisionId: layout._id,
        }],
      });
      assert.deepEqual(readiness.blockers, []);

      const projection = await getVenueManagementProjection({
        venueId: first.venue._id,
        actorUserId: actor._id,
      });
      assert.equal(projection.targets.length, 5);
      assert.deepEqual(
        projection.targets.map((target) => target.label).sort(),
        WORKS.map(([, label]) => label).sort(),
      );
    });
  } finally {
    await fs.rm(floorPlanRoot, { recursive: true, force: true });
  }
});
