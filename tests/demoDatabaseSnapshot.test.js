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
