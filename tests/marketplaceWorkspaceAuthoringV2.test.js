const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

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

test("creator workspace espone l'aggregate di authoring separato dalla risorsa marketable", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const { getCreatorWorkspace } = require("../services/marketplaceWorkspaceV2.service");

    const user = await User.create({ username: "workspace-authoring-user", passwordHash: "test-hash" });
    const subject = await Subject.create({ preferredLabel: "Opera da modificare", createdBy: user._id });
    const namespace = await Namespace.create({
      name: "Regole editoriali test",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const edition = await ItemEdition.create({
      itemId: item._id,
      namespaceId: namespace._id,
      createdBy: user._id,
    });

    const workspace = await getCreatorWorkspace({ actorUserId: user._id });
    const contentAsset = workspace.ownedAssets.find(
      (asset) => asset.resourceType === "item_edition" && String(asset.resourceId) === String(edition._id),
    );

    assert.ok(contentAsset);
    assert.equal(contentAsset.sourceRef.resourceType, "item_edition");
    assert.equal(String(contentAsset.sourceRef.resourceId), String(edition._id));
    assert.equal(contentAsset.authoringRef.resourceType, "item");
    assert.equal(String(contentAsset.authoringRef.resourceId), String(item._id));
    assert.notEqual(
      String(contentAsset.authoringRef.resourceId),
      String(contentAsset.resourceId),
      "l'editor deve ricevere l'Item, non l'ItemEdition marketable",
    );
    assert.equal(contentAsset.availableOperations.some((operation) => operation.code === "open_editor"), true);

    const namespaceAsset = workspace.ownedAssets.find(
      (asset) => asset.resourceType === "namespace" && String(asset.resourceId) === String(namespace._id),
    );
    assert.ok(namespaceAsset);
    assert.equal(namespaceAsset.authoringRef.resourceType, "namespace");
    assert.equal(String(namespaceAsset.authoringRef.resourceId), String(namespace._id));
  });
});
