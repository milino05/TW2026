const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

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

test("licensed context.generate records context_reference Adoption against the exact used release", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const { recordGenerationSourceAdoptions } = require("../services/generationApplicationV2.service");

    const owner = await User.create({ username: "generation-adoption-owner", passwordHash: "hash" });
    const buyer = await User.create({ username: "generation-adoption-buyer", passwordHash: "hash" });
    const namespace = await Namespace.create({ name: "Adoption namespace", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const space = await ContentSpace.create({ name: "Adoption space", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const context = await EditorialContext.create({ contentSpaceId: space._id, namespaceId: namespace._id, displayName: "Adoption context", createdBy: owner._id });
    const release = await EditorialRelease.create({
      editorialContextId: context._id,
      version: 1,
      namespaceRevisionId: oid(),
      graphRevisionId: oid(),
      itemBindings: [],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      releasedAt: new Date(),
      releasedBy: owner._id,
    });
    context.publishedReleaseId = release._id;
    await context.save();
    const entitlement = await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
      resourceType: "editorial_release",
      resourceId: release._id,
      capability: "context.generate",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "editorial_release", resourceId: release._id },
      status: "active",
    });

    const plan = {
      contextSnapshot: {
        editorialSources: [{
          requestedSourceRef: { resourceType: "editorial_release", resourceId: release._id },
          resolvedSourceRef: { resourceType: "editorial_release", resourceId: release._id },
          editorialContextId: context._id,
          editorialReleaseId: release._id,
          versionMode: "pinned",
        }],
      },
    };
    const adoptionIds = await recordGenerationSourceAdoptions({ plan, actorUserId: buyer._id });
    assert.equal(adoptionIds.length, 1);
    const adoption = await Adoption.findById(adoptionIds[0]).lean();
    assert.equal(String(adoption.entitlementId), String(entitlement._id));
    assert.equal(adoption.action, "context_reference");
    assert.equal(adoption.sourceResourceRef.resourceType, "editorial_release");
    assert.equal(String(adoption.sourceResourceRef.resourceId), String(release._id));
    assert.equal(adoption.sourceSnapshotRef.resourceType, "editorial_release");
    assert.equal(String(adoption.sourceSnapshotRef.resourceId), String(release._id));
  });
});
