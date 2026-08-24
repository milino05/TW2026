const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_aurora_dataset_v2`;
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

test("Aurora seed is idempotent and exposes a complete second Navigator museum", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Entitlement = require("../models/entitlement.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitV2 = require("../models/visitV2.model");
    const { createExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { listNavigatorLibrary, listNavigatorMuseums } = require("../services/navigatorVisitV2.service");
    const { seedExamDataset } = require("../scripts/examDatasetV2");
    const {
      AURORA_VENUE_ID,
      WORKS,
      VISIT_DEFINITIONS,
      seedAuroraDataset,
      verifyAuroraDataset,
    } = require("../scripts/auroraDatasetV2");

    const pinacoteca = await seedExamDataset();
    const aurora = await seedAuroraDataset({ pinacotecaVisitRecords: pinacoteca.visitRecords });
    const first = await verifyAuroraDataset();
    assert.equal(first.ok, true, JSON.stringify(first.failures));
    assert.equal(first.summary.publishedItems, 10);
    assert.equal(first.summary.publishedVisits, 3);
    assert.equal(first.summary.visitorEntitlements, 3);

    const visitor = aurora.users.visitatore1;
    const { museums } = await listNavigatorMuseums({ userId: visitor._id });
    assert.deepEqual(
      museums.map((museum) => String(museum.id)).sort(),
      [AURORA_VENUE_ID, "496f78e51b8861a9800749a7"].sort(),
    );

    const library = await listNavigatorLibrary({
      userId: visitor._id,
      configuredVenueId: AURORA_VENUE_ID,
    });
    assert.deepEqual(
      library.visits.map((visit) => visit.title).sort(),
      VISIT_DEFINITIONS.map((visit) => visit.title).sort(),
    );
    assert.deepEqual(
      library.visits.map((visit) => visit.stopCount).sort((a, b) => a - b),
      [7, 7, 10],
    );

    const preparation = await createExecutionPreparation({
      userId: visitor._id,
      payload: { visitId: aurora.visitRecords[0].visit._id },
    });
    assert.equal(preparation.readiness.status, "ready");
    assert.equal(String(preparation.preVisit.venues[0].id), AURORA_VENUE_ID);

    const reseededPinacoteca = await seedExamDataset();
    await seedAuroraDataset({ pinacotecaVisitRecords: reseededPinacoteca.visitRecords });
    const second = await verifyAuroraDataset();
    assert.equal(second.ok, true, JSON.stringify(second.failures));

    const auroraVisitIds = VISIT_DEFINITIONS.map((entry) =>
      require("crypto").createHash("sha1").update(`artaround-aurora:visit:${entry.key}`).digest("hex").slice(0, 24),
    );
    const auroraRevisionIds = WORKS.map((entry) =>
      require("crypto").createHash("sha1").update(`artaround-aurora:item-revision:${entry.key}`).digest("hex").slice(0, 24),
    );
    assert.equal(await VisitV2.countDocuments({ _id: { $in: auroraVisitIds } }), 3);
    assert.equal(await ItemRevisionV2.countDocuments({ _id: { $in: auroraRevisionIds } }), 10);
    assert.equal(await Entitlement.countDocuments({
      beneficiaryType: "user",
      beneficiaryId: visitor._id,
      resourceType: "visit",
      resourceId: { $in: auroraVisitIds },
      capability: "visit.execute",
      status: "active",
    }), 3);
  });
});
