const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_migrate_venue_exhibit_slots`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

test("Venue ExhibitSlot migration is guarded, dry-runnable and idempotent", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    const { migrateVenueExhibitSlots, stableSlotId } = require("../scripts/migrateVenueExhibitSlots");
    const venueId = new mongoose.Types.ObjectId();
    const subjectId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();
    const duplicateTargetId = new mongoose.Types.ObjectId();
    const layoutId = new mongoose.Types.ObjectId();
    const releaseId = new mongoose.Types.ObjectId();
    const placeId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const now = new Date();
    const targets = mongoose.connection.collection("venuetargets");
    await mongoose.connection.collection("subjects").insertOne({ _id: subjectId, preferredLabel: "Opera migrata" });
    await targets.insertMany([
      { _id: targetId, venueId, subjectId, label: "Etichetta storica", description: "Nota storica", publicCode: "legacy-target-code", lifecycleStatus: "active", createdBy: userId, createdAt: now },
      { _id: duplicateTargetId, venueId, subjectId, lifecycleStatus: "active", createdBy: userId, createdAt: now },
    ]);

    await assert.rejects(
      () => migrateVenueExhibitSlots({ dryRun: true }),
      (error) => error?.code === "DUPLICATE_ACTIVE_VENUE_SUBJECT" && error?.report?.length === 1,
    );
    await targets.deleteOne({ _id: duplicateTargetId });

    await mongoose.connection.collection("layoutrevisions").insertOne({
      _id: layoutId,
      venueId,
      version: 1,
      venueTargetPlacements: [{ venueTargetId: targetId, primaryPlaceId: placeId }],
      createdBy: userId,
      createdAt: now,
    });
    await mongoose.connection.collection("venuereleases").insertOne({
      _id: releaseId,
      venueId,
      layoutRevisionId: layoutId,
      targetBindings: [{ venueTargetId: targetId, availability: "active", recognitionMedia: [] }],
    });

    const dryRun = await migrateVenueExhibitSlots({ dryRun: true });
    assert.deepEqual(
      { layouts: dryRun.layouts, releases: dryRun.releases, exhibitSlots: dryRun.exhibitSlots, venueTargets: dryRun.venueTargets },
      { layouts: 1, releases: 1, exhibitSlots: 1, venueTargets: 1 },
    );
    assert.equal(await mongoose.connection.collection("exhibitslots").countDocuments(), 0);

    const migrated = await migrateVenueExhibitSlots();
    assert.equal(migrated.exhibitSlots, 1);
    const expectedSlotId = stableSlotId(`${venueId}:${targetId}:${placeId}`);
    const [layout, release, target, slot] = await Promise.all([
      mongoose.connection.collection("layoutrevisions").findOne({ _id: layoutId }),
      mongoose.connection.collection("venuereleases").findOne({ _id: releaseId }),
      targets.findOne({ _id: targetId }),
      mongoose.connection.collection("exhibitslots").findOne({ _id: expectedSlotId }),
    ]);
    assert.equal(layout.venueTargetPlacements, undefined);
    assert.equal(String(layout.exhibitSlots[0].exhibitSlotId), String(expectedSlotId));
    assert.equal(String(release.targetBindings[0].exhibitSlotId), String(expectedSlotId));
    assert.equal(target.displayLabelOverride, "Etichetta storica");
    assert.equal(target.inventoryNote, "Nota storica");
    assert.equal(target.label, undefined);
    assert.equal(target.description, undefined);
    assert.equal(slot.venueId.toString(), venueId.toString());
    assert.match(slot.publicCode, /^as_[a-f0-9]{24}$/);

    const rerun = await migrateVenueExhibitSlots();
    assert.equal(rerun.layouts, 0);
    assert.equal(await mongoose.connection.collection("exhibitslots").countDocuments(), 1);
    const index = (await targets.indexes()).find((entry) => entry.name === "unique_active_venue_subject");
    assert.equal(index.unique, true);
    assert.deepEqual(index.partialFilterExpression, { lifecycleStatus: "active" });
    const publicCodeIndex = (await targets.indexes()).find((entry) => entry.name === "publicCode_1");
    assert.equal(publicCodeIndex.unique, true);
    assert.deepEqual(publicCodeIndex.partialFilterExpression, { publicCode: { $type: "string" } });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
