const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

test("workspace resources separa context, ricerca e paginazione server-side", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const ContentSpace = require("../models/contentSpace.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const { getCreatorWorkspaceContext, listCreatorWorkspaceResources } = require("../services/marketplaceWorkspaceResourcesV2.service");

    const [owner, seller] = await User.create([
      { username: "workspace-browser-owner", passwordHash: "test-hash" },
      { username: "workspace-browser-seller", passwordHash: "test-hash" },
    ]);
    await ContentSpace.create({ name: "Spazio principale", ownerType: "user", ownerId: owner._id, createdBy: owner._id });

    const ownedNamespaces = [];
    for (let index = 0; index < 23; index += 1) {
      ownedNamespaces.push({
        name: index === 7 ? "Regole Speciale Rinascimento" : `Regole editoriali ${String(index).padStart(2, "0")}`,
        description: index === 7 ? "Vocabolario dedicato al Rinascimento" : "Regole di test",
        ownerType: "user", ownerId: owner._id, createdBy: owner._id,
      });
    }
    await Namespace.insertMany(ownedNamespaces);

    const context = await getCreatorWorkspaceContext({ actorUserId: owner._id });
    assert.equal(context.principal.type, "user");
    assert.equal(context.contentSpaces.length, 1);
    assert.equal(Object.hasOwn(context, "ownedAssets"), false, "il context leggero non deve materializzare le risorse");

    const firstPage = await listCreatorWorkspaceResources({
      actorUserId: owner._id, ownership: "owned", resourceTypes: ["namespace"], page: 1, limit: 10,
    });
    assert.equal(firstPage.total, 23);
    assert.equal(firstPage.pageSize, 10);
    assert.equal(firstPage.results.length, 10);
    assert.equal(firstPage.results.every((asset) => asset.resourceType === "namespace" && asset.ownership === "owned"), true);

    const thirdPage = await listCreatorWorkspaceResources({
      actorUserId: owner._id, ownership: "owned", resourceTypes: ["namespace"], page: 3, limit: 10,
    });
    assert.equal(thirdPage.total, 23);
    assert.equal(thirdPage.results.length, 3);

    const search = await listCreatorWorkspaceResources({
      actorUserId: owner._id, ownership: "owned", q: "Rinascimento", resourceTypes: ["namespace"], page: 1, limit: 10,
    });
    assert.equal(search.total, 1);
    assert.match(search.results[0].title, /Speciale Rinascimento/);
    assert.equal(search.results[0].authoringRef.resourceType, "namespace");
    assert.equal(search.results[0].availableOperations.some((entry) => entry.code === "open_editor"), true);

    const licensedNamespace = await Namespace.create({ name: "Regole esterne", ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const licensedRevision = await NamespaceRevision.create({
      namespaceId: licensedNamespace._id, version: 1, durationTypes: [], languageLevels: [], status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id }, createdBy: seller._id, updatedBy: seller._id,
    });
    licensedNamespace.publishedRevisionId = licensedRevision._id;
    await licensedNamespace.save();
    await Entitlement.create({
      beneficiaryType: "user", beneficiaryId: owner._id,
      resourceType: "namespace", resourceId: licensedNamespace._id,
      capability: "namespace.author", versionPolicy: "follow_current", status: "active",
    });

    const licensed = await listCreatorWorkspaceResources({ actorUserId: owner._id, ownership: "licensed", page: 1, limit: 10 });
    assert.equal(licensed.total, 1);
    assert.equal(licensed.results.length, 1);
    assert.equal(licensed.results[0].ownership, "licensed");
    assert.equal(licensed.results[0].availableOperations.some((entry) => entry.code === "namespace.author"), true);
  });
});