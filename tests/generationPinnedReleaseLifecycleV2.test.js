const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_generation_pinned_release_lifecycle_v2`;
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

test("pinned EditorialRelease remains a consumable generation source after live Collection and Item trash", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Entitlement = require("../models/entitlement.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const ItemV2 = require("../models/itemV2.model");
    const { IDS, seedExamDataset } = require("../scripts/examDatasetV2");
    const { loadEditorialScope } = require("../services/visitGeneratorV2.service");

    await seedExamDataset();
    const visitor = await User.findOne({ username: "visitatore1" });
    const release = await EditorialRelease.findById(IDS.editorialRelease).lean();
    assert.ok(visitor);
    assert.ok(release);
    assert.ok(release.itemBindings.length > 0);

    const pinnedItemId = release.itemBindings[0].itemId;
    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: visitor._id,
      resourceType: "editorial_release",
      resourceId: release._id,
      capability: "context.generate",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "editorial_release", resourceId: release._id },
      status: "active",
    });

    await Promise.all([
      EditorialContext.updateOne({ _id: release.editorialContextId }, { $set: { lifecycleStatus: "trashed" } }),
      ItemV2.updateOne({ _id: pinnedItemId }, { $set: { lifecycleStatus: "trashed" } }),
    ]);

    const scope = await loadEditorialScope({
      request: {
        editorialSources: [{ resourceType: "editorial_release", resourceId: release._id }],
      },
      physicalScope: {},
      actorUserId: visitor._id,
    });

    assert.equal(scope.source, "explicit");
    assert.equal(scope.resolvedSources.length, 1);
    assert.equal(scope.resolvedSources[0].versionMode, "pinned");
    assert.equal(String(scope.resolvedSources[0].editorialReleaseId), String(release._id));
    assert.equal(scope.contexts.some((context) => String(context._id) === String(release.editorialContextId)), true);
    assert.equal(scope.baseCandidates.some((candidate) => String(candidate.item._id) === String(pinnedItemId)), true);
    assert.equal(scope.federatedGraph.nodes.has(String(scope.baseCandidates.find((candidate) => String(candidate.item._id) === String(pinnedItemId)).item.primarySubjectId)), true);
  });
});