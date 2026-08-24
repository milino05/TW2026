const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

test("workspace resource detail autorizza e proietta una sola risorsa", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const { getCreatorWorkspaceResourceDetail } = require("../services/marketplaceWorkspaceResourcesV2.service");

    const [owner, seller] = await User.create([
      { username: "workspace-detail-owner", passwordHash: "test-hash" },
      { username: "workspace-detail-seller", passwordHash: "test-hash" },
    ]);

    const ownedNamespace = await Namespace.create({
      name: "Regole personali",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });

    const owned = await getCreatorWorkspaceResourceDetail({
      actorUserId: owner._id,
      ownership: "owned",
      resourceType: "namespace",
      resourceId: ownedNamespace._id,
    });
    assert.equal(owned.principal.type, "user");
    assert.equal(String(owned.asset.resourceId), String(ownedNamespace._id));
    assert.equal(owned.asset.ownership, "owned");
    assert.equal(owned.asset.authoringRef.resourceType, "namespace");
    assert.equal(owned.asset.availableOperations.some((entry) => entry.code === "open_editor"), true);
    assert.equal(Object.hasOwn(owned, "ownedAssets"), false);
    assert.equal(Object.hasOwn(owned, "licensedAssets"), false);

    const licensedNamespace = await Namespace.create({
      name: "Regole con licenza",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const revision = await NamespaceRevision.create({
      namespaceId: licensedNamespace._id,
      version: 1,
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    licensedNamespace.publishedRevisionId = revision._id;
    await licensedNamespace.save();
    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: owner._id,
      resourceType: "namespace",
      resourceId: licensedNamespace._id,
      capability: "namespace.author",
      versionPolicy: "follow_current",
      status: "active",
    });

    const licensed = await getCreatorWorkspaceResourceDetail({
      actorUserId: owner._id,
      ownership: "licensed",
      resourceType: "namespace",
      resourceId: licensedNamespace._id,
    });
    assert.equal(licensed.asset.ownership, "licensed");
    assert.equal(licensed.asset.title, "Regole con licenza");
    assert.equal(licensed.asset.availableOperations.some((entry) => entry.code === "namespace.author"), true);

    await assert.rejects(
      () => getCreatorWorkspaceResourceDetail({
        actorUserId: owner._id,
        ownership: "owned",
        resourceType: "namespace",
        resourceId: licensedNamespace._id,
      }),
      (error) => error?.status === 404 && error?.details?.some?.((entry) => entry.code === "WORKSPACE_RESOURCE_NOT_FOUND"),
    );
  });
});