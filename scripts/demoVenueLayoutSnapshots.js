const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const ExhibitSlot = require("../models/exhibitSlot.model");
const { configuredFloorPlanRoot } = require("../services/venueFloorPlanUpload.service");
const { MUSEUM_PLANS } = require("./examDatasetV3");

const SNAPSHOT_VERSION = 1;
const PUBLIC_FLOOR_PLAN_PREFIX = "/uploads/venue-floor-plans/";
const DEFAULT_FIXTURE_ROOT = path.join(__dirname, "fixtures", "demo-venue-layouts");
const SNAPSHOT_FILE = "layouts.json";

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extensionForMapAsset(mapAsset) {
  const byMime = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (byMime[mapAsset?.mimeType]) return byMime[mapAsset.mimeType];
  const ext = path.extname(String(mapAsset?.url || "")).replace(/^\./, "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  throw new Error(`Formato planimetria non supportato per la snapshot: ${mapAsset?.mimeType || mapAsset?.url || "sconosciuto"}`);
}

function uploadedFloorPlanPath(url, floorPlanRoot) {
  const normalized = String(url || "");
  if (!normalized.startsWith(PUBLIC_FLOOR_PLAN_PREFIX)) {
    throw new Error(`La planimetria ${normalized || "<vuota>"} non è un upload gestito da ArtAround`);
  }
  const relative = normalized.slice(PUBLIC_FLOOR_PLAN_PREFIX.length);
  const fileName = path.basename(relative);
  if (!fileName || fileName !== relative) throw new Error(`URL planimetria non valido: ${normalized}`);
  return path.join(floorPlanRoot, fileName);
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function loadSnapshotDocument({ fixtureRoot = DEFAULT_FIXTURE_ROOT, required = false } = {}) {
  const filePath = path.join(fixtureRoot, SNAPSHOT_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (parsed.version !== SNAPSHOT_VERSION) throw new Error(`Versione snapshot layout non supportata: ${parsed.version}`);
    if (!parsed.venues || typeof parsed.venues !== "object") throw new Error("Snapshot layout senza venues");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT" && !required) return null;
    throw error;
  }
}

async function exportDemoVenueLayoutSnapshots({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  floorPlanRoot = configuredFloorPlanRoot(),
} = {}) {
  const floorPlansFixtureRoot = path.join(fixtureRoot, "floor-plans");
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.mkdir(floorPlansFixtureRoot, { recursive: true });

  const document = {
    version: SNAPSHOT_VERSION,
    venues: {},
  };

  for (const plan of MUSEUM_PLANS) {
    const venue = await Venue.findById(plan.venueId).lean();
    if (!venue) throw new Error(`Venue demo non trovata nel database corrente: ${plan.key}`);

    const sourceReleaseId = venue.workingReleaseId || venue.publishedReleaseId;
    if (!sourceReleaseId) throw new Error(`Venue demo senza release utilizzabile: ${plan.key}`);
    const release = await VenueRelease.findById(sourceReleaseId).lean();
    if (!release) throw new Error(`VenueRelease demo non trovata: ${plan.key}`);
    const layout = await LayoutRevision.findById(release.layoutRevisionId).lean();
    if (!layout) throw new Error(`LayoutRevision demo non trovata: ${plan.key}`);

    const snapshot = jsonClone({
      floors: layout.floors || [],
      places: layout.places || [],
      exhibitSlots: layout.exhibitSlots || [],
      connections: layout.connections || [],
    });

    for (let index = 0; index < snapshot.floors.length; index += 1) {
      const floor = snapshot.floors[index];
      if (!floor.mapAsset) continue;
      const sourcePath = uploadedFloorPlanPath(floor.mapAsset.url, floorPlanRoot);
      const extension = extensionForMapAsset(floor.mapAsset);
      const fixtureName = `${plan.key}-floor-${index + 1}.${extension}`;
      const fixtureRelativePath = path.posix.join("floor-plans", fixtureName);
      const fixturePath = path.join(floorPlansFixtureRoot, fixtureName);
      await fs.copyFile(sourcePath, fixturePath);
      const sha256 = await sha256File(fixturePath);
      const seededFileName = `demo-${plan.key}-floor-${index + 1}.${extension}`;
      floor.mapAsset.url = `${PUBLIC_FLOOR_PLAN_PREFIX}${seededFileName}`;
      floor.mapAsset.fixture = { file: fixtureRelativePath, sha256 };
    }

    document.venues[plan.key] = {
      source: {
        venueId: String(venue._id),
        view: venue.workingReleaseId ? "working" : "published",
      },
      layout: snapshot,
    };
  }

  await fs.writeFile(path.join(fixtureRoot, SNAPSHOT_FILE), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return {
    fixtureRoot,
    venues: Object.keys(document.venues),
  };
}

async function materializeLayoutAssets(layout, {
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  floorPlanRoot = configuredFloorPlanRoot(),
} = {}) {
  const materialized = jsonClone(layout);
  await fs.mkdir(floorPlanRoot, { recursive: true });

  for (const floor of materialized.floors || []) {
    if (!floor.mapAsset) continue;
    const fixture = floor.mapAsset.fixture;
    if (!fixture?.file) throw new Error(`Fixture file mancante per la planimetria del piano ${floor.label || floor._id}`);
    const sourcePath = path.join(fixtureRoot, fixture.file);
    const actualHash = await sha256File(sourcePath);
    if (fixture.sha256 && actualHash !== fixture.sha256) {
      throw new Error(`Checksum planimetria non valido per ${fixture.file}`);
    }
    const destinationPath = uploadedFloorPlanPath(floor.mapAsset.url, floorPlanRoot);
    await fs.copyFile(sourcePath, destinationPath);
    delete floor.mapAsset.fixture;
  }

  return materialized;
}

async function applyDemoVenueLayoutSnapshots({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  floorPlanRoot = configuredFloorPlanRoot(),
} = {}) {
  const document = await loadSnapshotDocument({ fixtureRoot, required: false });
  if (!document) return { applied: false, venues: [] };

  const applied = [];
  for (const plan of MUSEUM_PLANS) {
    const entry = document.venues[plan.key];
    if (!entry?.layout) throw new Error(`Snapshot layout mancante per ${plan.key}`);

    const venue = await Venue.findById(plan.venueId);
    if (!venue?.publishedReleaseId) throw new Error(`Venue demo pubblicata non disponibile dopo il seed: ${plan.key}`);
    const release = await VenueRelease.findById(venue.publishedReleaseId);
    if (!release) throw new Error(`VenueRelease pubblicata non disponibile dopo il seed: ${plan.key}`);
    const layout = await LayoutRevision.findById(release.layoutRevisionId);
    if (!layout) throw new Error(`LayoutRevision pubblicata non disponibile dopo il seed: ${plan.key}`);

    const materialized = await materializeLayoutAssets(entry.layout, { fixtureRoot, floorPlanRoot });
    const existingSlotIds = new Set((await ExhibitSlot.find({ venueId: venue._id }).select("_id").lean()).map((slot) => String(slot._id)));
    for (const slot of materialized.exhibitSlots || []) {
      if (!existingSlotIds.has(String(slot.exhibitSlotId))) {
        throw new Error(`Snapshot ${plan.key} riferisce ExhibitSlot non appartenente al dataset demo: ${slot.exhibitSlotId}`);
      }
    }

    layout.floors = materialized.floors || [];
    layout.places = materialized.places || [];
    layout.exhibitSlots = materialized.exhibitSlots || [];
    layout.connections = materialized.connections || [];
    await layout.save();
    applied.push(plan.key);
  }

  return { applied: true, venues: applied };
}

module.exports = {
  SNAPSHOT_VERSION,
  PUBLIC_FLOOR_PLAN_PREFIX,
  DEFAULT_FIXTURE_ROOT,
  loadSnapshotDocument,
  exportDemoVenueLayoutSnapshots,
  materializeLayoutAssets,
  applyDemoVenueLayoutSnapshots,
};
