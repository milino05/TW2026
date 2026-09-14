const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { materializeLayoutAssets } = require("../scripts/demoVenueLayoutSnapshots");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("materializeLayoutAssets copia la planimetria versionata e rimuove i metadati fixture", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-demo-layout-"));
  const fixtureRoot = path.join(root, "fixture");
  const floorPlanRoot = path.join(root, "uploads");
  const fixtureFile = path.join(fixtureRoot, "floor-plans", "pinacoteca-floor-1.png");
  const bytes = Buffer.from("demo-floor-plan-bytes");

  try {
    await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
    await fs.writeFile(fixtureFile, bytes);
    const layout = {
      floors: [{
        _id: "64b000000000000000000001",
        label: "Piano terra",
        mapAsset: {
          url: "/uploads/venue-floor-plans/demo-pinacoteca-floor-1.png",
          mimeType: "image/png",
          width: 100,
          height: 100,
          originalName: "pinacoteca.png",
          fixture: {
            file: "floor-plans/pinacoteca-floor-1.png",
            sha256: sha256(bytes),
          },
        },
      }],
      places: [],
      exhibitSlots: [],
      connections: [],
    };

    const materialized = await materializeLayoutAssets(layout, { fixtureRoot, floorPlanRoot });
    const copied = await fs.readFile(path.join(floorPlanRoot, "demo-pinacoteca-floor-1.png"));

    assert.deepEqual(copied, bytes);
    assert.equal(materialized.floors[0].mapAsset.fixture, undefined);
    assert.equal(materialized.floors[0].mapAsset.url, "/uploads/venue-floor-plans/demo-pinacoteca-floor-1.png");
    assert.ok(layout.floors[0].mapAsset.fixture, "la fixture originale non deve essere mutata");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("materializeLayoutAssets rifiuta una planimetria con checksum diverso", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-demo-layout-"));
  const fixtureRoot = path.join(root, "fixture");
  const floorPlanRoot = path.join(root, "uploads");
  const fixtureFile = path.join(fixtureRoot, "floor-plans", "mambo-floor-1.png");

  try {
    await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
    await fs.writeFile(fixtureFile, Buffer.from("changed"));
    const layout = {
      floors: [{
        label: "Piano terra",
        mapAsset: {
          url: "/uploads/venue-floor-plans/demo-mambo-floor-1.png",
          fixture: {
            file: "floor-plans/mambo-floor-1.png",
            sha256: sha256(Buffer.from("expected")),
          },
        },
      }],
      places: [],
      exhibitSlots: [],
      connections: [],
    };

    await assert.rejects(
      materializeLayoutAssets(layout, { fixtureRoot, floorPlanRoot }),
      /Checksum planimetria non valido/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
