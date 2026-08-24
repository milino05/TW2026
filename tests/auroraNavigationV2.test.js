const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_aurora_navigation_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

test("Aurora visit starts with its pinned map and ten projected stops", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    const { createExecutionPreparation, startExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { projectSessionMap } = require("../services/navigationProjectionV2.service");
    const { seedExamDataset } = require("../scripts/examDatasetV2");
    const { AURORA_MAP_URL, AURORA_VENUE_ID, seedAuroraDataset } = require("../scripts/auroraDatasetV2");

    const pinacoteca = await seedExamDataset();
    const aurora = await seedAuroraDataset({ pinacotecaVisitRecords: pinacoteca.visitRecords });
    const visitor = aurora.users.visitatore1;
    const preparation = await createExecutionPreparation({
      userId: visitor._id,
      payload: { visitId: aurora.visitRecords[0].visit._id },
    });
    const started = await startExecutionPreparation({
      preparationId: preparation.id,
      userId: visitor._id,
      expectedVersion: preparation.version,
    });
    const map = await projectSessionMap({ sessionId: started.session._id, userId: visitor._id });

    assert.equal(String(map.venues[0].id), AURORA_VENUE_ID);
    assert.equal(map.venues[0].floors[0].map.imageUrl, AURORA_MAP_URL);
    assert.equal(map.venues[0].stops.length, 10);
    assert.equal(started.current.session.currentEntryIndex, 0);
    assert.equal(String(started.current.current.anchor.venueId), AURORA_VENUE_ID);
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
