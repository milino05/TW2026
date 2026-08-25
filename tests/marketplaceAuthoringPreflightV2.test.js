const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

function controls() {
  return {
    durationTypes: [{ definitionId: "duration:short", key: "short", label: "Breve", targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language:plain", key: "plain", label: "Semplice" }],
  };
}

async function createReadyNamespace({ Namespace, NamespaceRevision, owner, name, version = 1 }) {
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version,
    ...controls(),
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  namespace.workingRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

test("authoring preflight blocca prima di creare Item quando le regole editoriali non sono pronte", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const { getMarketplaceAuthoringPreflight } = require("../services/marketplaceAuthoringPreflightV2.service");

    const user = await User.create({ username: "preflight-owner", passwordHash: "test-hash" });

    const missing = await getMarketplaceAuthoringPreflight({ actorUserId: user._id });
    assert.equal(missing.content.allowed, false);
    assert.equal(missing.content.usableNamespaceCount, 0);
    assert.equal(missing.content.blockers[0].code, "NAMESPACE_REQUIRED");

    const namespace = await Namespace.create({
      name: "Regole da configurare",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const revision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.workingRevisionId = revision._id;
    await namespace.save();

    const incomplete = await getMarketplaceAuthoringPreflight({ actorUserId: user._id });
    assert.equal(incomplete.content.allowed, false);
    assert.equal(incomplete.content.needsConfigurationCount, 1);
    assert.equal(incomplete.content.blockers[0].code, "NAMESPACE_CONTROLS_REQUIRED");

    revision.durationTypes = controls().durationTypes;
    revision.languageLevels = controls().languageLevels;
    await revision.save();

    const ready = await getMarketplaceAuthoringPreflight({ actorUserId: user._id });
    assert.equal(ready.content.allowed, true);
    assert.equal(ready.content.usableNamespaceCount, 1);
    assert.equal(String(ready.content.usableNamespaces[0].id), String(namespace._id));
    assert.equal(ready.content.usableNamespaces[0].durationTypeCount, 1);
    assert.equal(ready.content.usableNamespaces[0].languageLevelCount, 1);
    assert.deepEqual(ready.content.blockers, []);

    for (let index = 0; index < 9; index += 1) {
      await createReadyNamespace({ Namespace, NamespaceRevision, owner: user, name: `Regole pronte ${index + 2}` });
    }
    const many = await getMarketplaceAuthoringPreflight({ actorUserId: user._id });
    assert.equal(many.content.usableNamespaceCount, 10);
    assert.equal(many.content.usableNamespaces.length, 10, "il preflight non deve nascondere Namespace utilizzabili all'editor");
  });
});

test("authoring preflight riconosce una NamespaceRevision pinned con namespace.author", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const { getMarketplaceAuthoringPreflight } = require("../services/marketplaceAuthoringPreflightV2.service");

    const [buyer, seller] = await User.create([
      { username: "preflight-buyer", passwordHash: "test-hash" },
      { username: "preflight-seller", passwordHash: "test-hash" },
    ]);
    const namespace = await Namespace.create({
      name: "Regole esterne pronte",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const revision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      ...controls(),
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    namespace.publishedRevisionId = revision._id;
    await namespace.save();
    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
      resourceType: "namespace_revision",
      resourceId: revision._id,
      capability: "namespace.author",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "namespace_revision", resourceId: revision._id },
      status: "active",
    });

    const preflight = await getMarketplaceAuthoringPreflight({ actorUserId: buyer._id });
    assert.equal(preflight.content.allowed, true);
    assert.equal(preflight.content.usableNamespaceCount, 1);
    assert.equal(preflight.content.usableNamespaces[0].source, "licensed");
    assert.equal(String(preflight.content.usableNamespaces[0].revisionId), String(revision._id));
  });
});