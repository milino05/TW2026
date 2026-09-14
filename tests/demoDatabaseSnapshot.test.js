const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");

const {
  encodeDocument,
  decodeDocument,
  snapshotAssetTree,
  restoreAssetTree,
  exportDemoDatabaseSnapshot,
  restoreDemoDatabaseSnapshot,
} = require("../scripts/demoDatabaseSnapshot");

test("database snapshot preserves BSON values through canonical EJSON", () => {
  const objectId = new mongoose.Types.ObjectId();
  const when = new Date("2026-09-14T18:00:00.000Z");
  const decimal = mongoose.mongo.Decimal128.fromString("1234.5678");
  const binary = new mongoose.mongo.Binary(Buffer.from([1, 2, 3, 4]));
  const source = {
    _id: objectId,
    when,
    decimal,
    binary,
    nested: { count: new mongoose.mongo.Int32(7) },
  };

  const decoded = decodeDocument(encodeDocument(source));
  assert.equal(String(decoded._id), String(objectId));
  assert.equal(decoded.when.toISOString(), when.toISOString());
  assert.equal(decoded.decimal.toString(), decimal.toString());
  assert.deepEqual(Buffer.from(decoded.binary.buffer), Buffer.from([1, 2, 3, 4]));
  assert.equal(decoded.nested.count.valueOf(), 7);
});

test("asset snapshot copies and restores exact bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-demo-db-snapshot-"));
  const source = path.join(root, "source");
  const fixture = path.join(root, "fixture");
  const restored = path.join(root, "restored");
  try {
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "plan.png"), Buffer.from([0, 1, 2, 3, 4]));
    await fs.writeFile(path.join(source, "nested", "recognition.webp"), Buffer.from([9, 8, 7, 6]));

    const manifest = await snapshotAssetTree({ sourceRoot: source, fixtureRoot: fixture });
    assert.equal(manifest.length, 2);
    await restoreAssetTree({ fixtureRoot: fixture, destinationRoot: restored, files: manifest });

    assert.deepEqual(await fs.readFile(path.join(restored, "plan.png")), Buffer.from([0, 1, 2, 3, 4]));
    assert.deepEqual(await fs.readFile(path.join(restored, "nested", "recognition.webp")), Buffer.from([9, 8, 7, 6]));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("full snapshot restores collections, indexes and assets while clearing auth sessions", { skip: !process.env.MONGO_URI }, async () => {
  const client = new mongoose.mongo.MongoClient(process.env.MONGO_URI);
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-demo-db-fixture-"));
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-demo-db-assets-"));
  const databaseName = `artaround_snapshot_${new mongoose.Types.ObjectId().toHexString()}`;
  const db = client.db(databaseName);
  const sourceAssets = path.join(assetsRoot, "source");
  const runtimeAssets = path.join(assetsRoot, "runtime");
  try {
    await client.connect();
    await db.createCollection("widgets");
    await db.collection("widgets").insertMany([
      { _id: new mongoose.Types.ObjectId(), label: "uno", at: new Date("2026-09-14T10:00:00.000Z") },
      { _id: new mongoose.Types.ObjectId(), label: "due", amount: mongoose.mongo.Decimal128.fromString("9.50") },
    ]);
    await db.collection("widgets").createIndex({ label: 1 }, { unique: true, name: "label_unique" });
    await db.createCollection("sessions");
    await db.collection("sessions").insertOne({
      _id: new mongoose.Types.ObjectId(),
      tokenHash: "runtime-only",
      ipAddress: "127.0.0.1",
      expiresAt: new Date("2026-09-15T10:00:00.000Z"),
    });
    await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_1" });

    await fs.mkdir(sourceAssets, { recursive: true });
    await fs.writeFile(path.join(sourceAssets, "asset.bin"), Buffer.from([4, 3, 2, 1]));

    const assetRoots = { "test-assets": sourceAssets };
    const exported = await exportDemoDatabaseSnapshot({ fixtureRoot, db, assetRoots });
    assert.equal(exported.collections, 2);
    assert.deepEqual(exported.excludedRuntimeDocuments, ["sessions"]);

    await db.collection("widgets").deleteMany({});
    await db.collection("widgets").insertOne({ label: "mutated" });
    await fs.mkdir(runtimeAssets, { recursive: true });
    await fs.writeFile(path.join(runtimeAssets, "stale.bin"), Buffer.from([8, 8, 8]));

    await restoreDemoDatabaseSnapshot({
      fixtureRoot,
      db,
      assetRoots: { "test-assets": runtimeAssets },
    });

    const widgets = await db.collection("widgets").find({}).sort({ label: 1 }).toArray();
    assert.deepEqual(widgets.map((entry) => entry.label), ["due", "uno"]);
    assert.equal(widgets.find((entry) => entry.label === "uno").at.toISOString(), "2026-09-14T10:00:00.000Z");
    assert.equal(widgets.find((entry) => entry.label === "due").amount.toString(), "9.50");
    const indexes = await db.collection("widgets").indexes();
    assert.ok(indexes.some((entry) => entry.name === "label_unique" && entry.unique === true));
    assert.equal(await db.collection("sessions").countDocuments(), 0);
    assert.deepEqual(await fs.readFile(path.join(runtimeAssets, "asset.bin")), Buffer.from([4, 3, 2, 1]));
    await assert.rejects(fs.access(path.join(runtimeAssets, "stale.bin")));
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close().catch(() => {});
    await fs.rm(fixtureRoot, { recursive: true, force: true });
    await fs.rm(assetsRoot, { recursive: true, force: true });
  }
});
