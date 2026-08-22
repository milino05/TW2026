const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_exam_dataset_v2`;
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

test("exam dataset seed is idempotent and satisfies the automatic delivery verifier", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Venue = require("../models/venue.model");
    const VisitV2 = require("../models/visitV2.model");
    const { IDS, VISIT_DEFINITIONS, seedExamDataset, verifyExamDataset } = require("../scripts/examDatasetV2");

    await seedExamDataset();
    const first = await verifyExamDataset();
    assert.equal(first.ok, true, JSON.stringify(first.failures));
    assert.equal(first.summary.requiredUsers, 4);
    assert.ok(first.summary.activeVenueTargets >= 10);
    assert.equal(first.summary.publishedVisits, 3);
    assert.ok(first.summary.marketplaceListings >= 3);
    assert.ok(first.summary.activeOffers >= 3);

    const venue = await Venue.findById(IDS.venue).lean();
    assert.equal(venue.name, "Pinacoteca Nazionale di Bologna");
    const author1 = await User.findOne({ username: "autore1" }).lean();
    const author2 = await User.findOne({ username: "autore2" }).lean();
    assert.equal(author1.organizationMemberships.some((entry) => String(entry.organizationId) === String(IDS.organization) && entry.role === "manager"), true);
    assert.equal(author2.organizationMemberships.some((entry) => String(entry.organizationId) === String(IDS.organization) && entry.role === "operator"), true);

    await seedExamDataset();
    const second = await verifyExamDataset();
    assert.equal(second.ok, true, JSON.stringify(second.failures));
    assert.equal(await VisitV2.countDocuments({ _id: { $in: VISIT_DEFINITIONS.map((entry) => require("crypto").createHash("sha1").update(`artaround-exam:visit:${entry.key}`).digest("hex").slice(0, 24)) } }), 3);
  });
});
