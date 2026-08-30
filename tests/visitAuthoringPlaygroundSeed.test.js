const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
const User = require("../models/user");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const { WORKS, seedVisitAuthoringPlayground } = require("../scripts/seedVisitAuthoringPlayground");
const { listVenueAuthoringTargets } = require("../services/venueAuthoringTargetsV2.service");

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

test("visit authoring playground crea cinque tappe pubblicate ed è idempotente", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    await User.create({ username: "visit-ui-test", passwordHash: "test-hash" });

    const first = await seedVisitAuthoringPlayground({ username: "visit-ui-test" });
    const second = await seedVisitAuthoringPlayground({ username: "visit-ui-test" });

    assert.equal(String(first.organization._id), String(second.organization._id));
    assert.equal(String(first.venue._id), String(second.venue._id));
    assert.equal(first.stops.length, 5);
    assert.equal(await VenueTarget.countDocuments({ venueId: first.venue._id, lifecycleStatus: "active" }), 5);

    const release = await VenueRelease.findById(first.venue.publishedReleaseId).lean();
    assert.ok(release);
    assert.equal(release.status, "published");
    assert.equal(release.integrity.status, "valid");
    assert.equal(release.targetBindings.length, 5);

    const projection = await listVenueAuthoringTargets({ venueId: first.venue._id });
    assert.equal(projection.targets.length, 5);
    assert.deepEqual(
      projection.targets.map((target) => target.label),
      WORKS.map(([, label]) => label),
    );
  });
});
