const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_semantic_graph_index_readiness`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

async function resetDatabase() {
  await mongoose.connection.dropDatabase();
}

test("la readiness sostituisce l'indice legacy editorialContextId/version senza bloccare nuovi grafi v1", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await resetDatabase();
    const collection = mongoose.connection.db.collection("semantic_graph_revisions_v2");
    const firstGraphId = new mongoose.Types.ObjectId();
    const secondGraphId = new mongoose.Types.ObjectId();
    await collection.insertOne({ semanticGraphId: firstGraphId, version: 1, createdAt: new Date() });
    await collection.createIndex(
      { editorialContextId: 1, version: 1 },
      { unique: true, name: "editorialContextId_1_version_1" },
    );
    await collection.createIndex(
      { editorialContextId: 1, createdAt: -1 },
      { name: "editorialContextId_1_createdAt_-1" },
    );

    await assert.rejects(
      collection.insertOne({ semanticGraphId: secondGraphId, version: 1, createdAt: new Date() }),
      (error) => Number(error?.code) === 11000,
    );

    const { ensureSemanticGraphRevisionIndexes } = require("../services/databaseSchemaReadiness.service");
    const first = await ensureSemanticGraphRevisionIndexes();
    assert.equal(first.changed, true);
    assert.deepEqual(new Set(first.droppedIndexes), new Set([
      "editorialContextId_1_version_1",
      "editorialContextId_1_createdAt_-1",
    ]));

    await collection.insertOne({ semanticGraphId: secondGraphId, version: 1, createdAt: new Date() });
    const indexes = await collection.indexes();
    assert.equal(indexes.some((index) => index.name === "editorialContextId_1_version_1"), false);
    assert.equal(indexes.some((index) => (
      index.key?.semanticGraphId === 1 && index.key?.version === 1 && index.unique === true
    )), true);
    assert.equal(indexes.some((index) => (
      index.key?.semanticGraphId === 1 && index.key?.createdAt === -1
    )), true);

    const second = await ensureSemanticGraphRevisionIndexes();
    assert.equal(second.changed, false);
  } finally {
    await resetDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});

test("la readiness non converte documenti editoriali legacy senza la migrazione di dominio", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await resetDatabase();
    const collection = mongoose.connection.db.collection("semantic_graph_revisions_v2");
    await collection.insertOne({
      editorialContextId: new mongoose.Types.ObjectId(),
      version: 1,
      createdAt: new Date(),
    });
    await collection.createIndex(
      { editorialContextId: 1, version: 1 },
      { unique: true, name: "editorialContextId_1_version_1" },
    );

    const { ensureSemanticGraphRevisionIndexes } = require("../services/databaseSchemaReadiness.service");
    await assert.rejects(
      ensureSemanticGraphRevisionIndexes(),
      (error) => (
        error?.code === "EDITORIAL_INVENTORY_MIGRATION_REQUIRED"
        && /migrate:editorial-inventory/.test(error.message)
        && error.legacyDocuments === 1
      ),
    );

    const documents = await collection.find({}).toArray();
    assert.equal(documents.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(documents[0], "editorialContextId"), true);
    assert.equal(Object.prototype.hasOwnProperty.call(documents[0], "semanticGraphId"), false);
  } finally {
    await resetDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
