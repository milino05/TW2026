const crypto = require("node:crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

function id(value) { return String(value?._id || value || ""); }
function stableSlotId(key) { return new mongoose.Types.ObjectId(crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)); }
function publicCode() { return `as_${crypto.randomBytes(12).toString("hex")}`; }

async function duplicateActiveVenueSubjects() {
  return mongoose.connection.collection("venuetargets").aggregate([
    { $match: { lifecycleStatus: "active" } },
    { $group: { _id: { venueId: "$venueId", subjectId: "$subjectId" }, count: { $sum: 1 }, venueTargetIds: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
}

async function migrateVenueExhibitSlots({ dryRun = false } = {}) {
  const duplicates = await duplicateActiveVenueSubjects();
  if (duplicates.length) {
    const error = new Error("Migrazione interrotta: esistono più VenueTarget attivi per la stessa coppia Venue+Subject");
    error.code = "DUPLICATE_ACTIVE_VENUE_SUBJECT";
    error.report = duplicates.map((entry) => ({
      venueId: id(entry._id.venueId),
      subjectId: id(entry._id.subjectId),
      venueTargetIds: entry.venueTargetIds.map(id),
    }));
    throw error;
  }

  const layoutsCollection = mongoose.connection.collection("layoutrevisions");
  const releasesCollection = mongoose.connection.collection("venuereleases");
  const targetsCollection = mongoose.connection.collection("venuetargets");
  const subjectsCollection = mongoose.connection.collection("subjects");
  const slotsCollection = mongoose.connection.collection("exhibitslots");
  const layouts = await layoutsCollection.find({ "venueTargetPlacements.0": { $exists: true } }).sort({ venueId: 1, version: 1 }).toArray();
  const targets = await targetsCollection.find({}).toArray();
  const subjects = targets.length ? await subjectsCollection.find({ _id: { $in: targets.map((entry) => entry.subjectId) } }).project({ preferredLabel: 1 }).toArray() : [];
  const targetById = new Map(targets.map((entry) => [id(entry._id), entry]));
  const subjectById = new Map(subjects.map((entry) => [id(entry._id), entry]));
  const slotByTuple = new Map();
  const slotDocuments = new Map();
  const layoutUpdates = [];

  for (const layout of layouts) {
    const exhibitSlots = [];
    for (const placement of layout.venueTargetPlacements || []) {
      const target = targetById.get(id(placement.venueTargetId));
      if (!target) throw new Error(`VenueTarget ${id(placement.venueTargetId)} mancante nella LayoutRevision ${id(layout._id)}`);
      const tuple = `${id(layout.venueId)}:${id(target._id)}:${id(placement.primaryPlaceId)}`;
      const exhibitSlotId = stableSlotId(tuple);
      slotByTuple.set(tuple, exhibitSlotId);
      if (!slotDocuments.has(id(exhibitSlotId))) slotDocuments.set(id(exhibitSlotId), {
        _id: exhibitSlotId,
        venueId: layout.venueId,
        publicCode: publicCode(),
        lifecycleStatus: "active",
        trashedAt: null,
        trashedBy: null,
        createdBy: target.createdBy || layout.createdBy,
        createdAt: layout.createdAt || new Date(),
        updatedAt: new Date(),
      });
      const subject = subjectById.get(id(target.subjectId));
      exhibitSlots.push({
        exhibitSlotId,
        placeId: placement.primaryPlaceId,
        label: String(target.label || target.displayLabelOverride || subject?.preferredLabel || "Slot espositivo").trim(),
        order: null,
        approachGuidance: { defaultInstruction: null, overrides: [] },
      });
    }
    layoutUpdates.push({ layoutId: layout._id, exhibitSlots });
  }

  const releaseUpdates = [];
  const releases = layoutUpdates.length
    ? await releasesCollection.find({ layoutRevisionId: { $in: layoutUpdates.map((entry) => entry.layoutId) } }).toArray()
    : [];
  const layoutById = new Map(layouts.map((entry) => [id(entry._id), entry]));
  for (const release of releases) {
    const layout = layoutById.get(id(release.layoutRevisionId));
    const placementByTargetId = new Map((layout?.venueTargetPlacements || []).map((entry) => [id(entry.venueTargetId), entry]));
    const targetBindings = (release.targetBindings || []).map((binding) => {
      const placement = placementByTargetId.get(id(binding.venueTargetId));
      if (!placement) return { ...binding, exhibitSlotId: null };
      const tuple = `${id(layout.venueId)}:${id(binding.venueTargetId)}:${id(placement.primaryPlaceId)}`;
      return { ...binding, exhibitSlotId: slotByTuple.get(tuple) || null };
    });
    releaseUpdates.push({ releaseId: release._id, targetBindings });
  }

  const targetUpdates = targets.map((target) => ({
    targetId: target._id,
    displayLabelOverride: target.displayLabelOverride || target.label || null,
    inventoryNote: target.inventoryNote || target.description || null,
  }));
  const report = {
    dryRun,
    layouts: layoutUpdates.length,
    releases: releaseUpdates.length,
    exhibitSlots: slotDocuments.size,
    venueTargets: targetUpdates.length,
    duplicateActiveVenueSubjects: 0,
  };
  if (dryRun) return report;

  await mongoose.connection.transaction(async (session) => {
    if (slotDocuments.size) await slotsCollection.bulkWrite([...slotDocuments.values()].map((document) => ({
      updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true },
    })), { session });
    if (layoutUpdates.length) await layoutsCollection.bulkWrite(layoutUpdates.map((entry) => ({
      updateOne: { filter: { _id: entry.layoutId }, update: { $set: { exhibitSlots: entry.exhibitSlots }, $unset: { venueTargetPlacements: "" } } },
    })), { session });
    if (releaseUpdates.length) await releasesCollection.bulkWrite(releaseUpdates.map((entry) => ({
      updateOne: { filter: { _id: entry.releaseId }, update: { $set: { targetBindings: entry.targetBindings } } },
    })), { session });
    if (targetUpdates.length) await targetsCollection.bulkWrite(targetUpdates.map((entry) => ({
      updateOne: { filter: { _id: entry.targetId }, update: { $set: { displayLabelOverride: entry.displayLabelOverride, inventoryNote: entry.inventoryNote }, $unset: { label: "", description: "" } } },
    })), { session });
  });

  const indexes = await targetsCollection.indexes();
  const legacyPairIndex = indexes.find((entry) => entry.key?.venueId === 1 && entry.key?.subjectId === 1 && entry.name !== "unique_active_venue_subject");
  if (legacyPairIndex) await targetsCollection.dropIndex(legacyPairIndex.name);
  const legacyPublicCodeIndex = indexes.find((entry) => entry.key?.publicCode === 1 && !entry.sparse);
  if (legacyPublicCodeIndex) await targetsCollection.dropIndex(legacyPublicCodeIndex.name);
  if (legacyPublicCodeIndex || !indexes.some((entry) => entry.key?.publicCode === 1 && entry.sparse)) {
    await targetsCollection.createIndex({ publicCode: 1 }, { unique: true, sparse: true, name: "publicCode_1" });
  }
  await targetsCollection.createIndex(
    { venueId: 1, subjectId: 1 },
    { unique: true, partialFilterExpression: { lifecycleStatus: "active" }, name: "unique_active_venue_subject" },
  );
  return report;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try { console.log(JSON.stringify(await migrateVenueExhibitSlots({ dryRun: process.argv.includes("--dry-run") }), null, 2)); }
  finally { await mongoose.disconnect(); }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(JSON.stringify({ message: error.message, code: error.code, report: error.report || null }, null, 2));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrateVenueExhibitSlots, duplicateActiveVenueSubjects, stableSlotId };
