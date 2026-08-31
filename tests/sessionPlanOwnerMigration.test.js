const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_session_plan_owner_migration`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

test("la readiness migra i SessionPlan autonomi esistenti verso l'owner tipizzato senza fallback runtime", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    const collection = mongoose.connection.db.collection("session_plan_revisions_v2");
    const firstSessionId = new mongoose.Types.ObjectId();
    const secondSessionId = new mongoose.Types.ObjectId();
    await collection.insertMany([
      { sessionId: firstSessionId, version: 1, status: "active" },
      { sessionId: secondSessionId, version: 1, status: "active" },
    ]);
    await collection.createIndex({ sessionId: 1, version: 1 }, { unique: true, name: "sessionId_1_version_1" });
    await collection.createIndex({ sessionId: 1, status: 1 }, { name: "sessionId_1_status_1" });

    const { ensureSessionPlanOwnerShape } = require("../services/databaseSchemaReadiness.service");
    const first = await ensureSessionPlanOwnerShape();
    assert.equal(first.migratedDocuments, 2);
    const documents = await collection.find({}).sort({ planOwnerId: 1 }).toArray();
    assert.equal(documents.every((entry) => entry.planOwnerType === "visit_session"), true);
    assert.equal(documents.every((entry) => entry.planOwnerId && !Object.prototype.hasOwnProperty.call(entry, "sessionId")), true);
    assert.deepEqual(new Set(documents.map((entry) => String(entry.planOwnerId))), new Set([String(firstSessionId), String(secondSessionId)]));
    const indexes = await collection.indexes();
    assert.equal(indexes.some((index) => index.name === "sessionId_1_version_1" || index.name === "sessionId_1_status_1"), false);
    assert.equal(indexes.some((index) => index.name === "planOwnerType_1_planOwnerId_1_version_1" && index.unique), true);

    const second = await ensureSessionPlanOwnerShape();
    assert.equal(second.changed, false);
    assert.equal(second.migratedDocuments, 0);
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
