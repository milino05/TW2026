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

async function createNamespaceRevision({ namespaceId, version, userId, durationIds, status = "published" }) {
  const NamespaceRevision = require("../models/namespaceRevision.model");
  return NamespaceRevision.create({
    namespaceId,
    version,
    durationTypes: durationIds.map((definitionId, index) => ({
      definitionId,
      key: `duration-${index}`,
      label: definitionId,
      targetSeconds: 60 + index * 30,
    })),
    languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
    presentationAspects: [{ definitionId: "aspect-story", key: "story", label: "Racconto" }],
    selectionSignals: [{ definitionId: "signal-core", key: "core", label: "Principale" }],
    relationTypes: [],
    subjectClasses: [],
    status,
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
}

async function createPublishedConsumer({ namespace, namespaceRevision, userId }) {
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const item = await ItemV2.create({
    primarySubjectId: oid(),
    ownerType: "user",
    ownerId: userId,
    createdBy: userId,
  });
  const edition = await ItemEdition.create({
    itemId: item._id,
    namespaceId: namespace._id,
    namespaceDependency: { versionPolicy: "follow_current", pinnedRevisionId: null, validation: null },
    createdBy: userId,
  });
  const variantId = oid();
  const representationId = oid();
  const revision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label: "Consumer v1",
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    selectionSignals: [{ definitionId: "signal-core", weight: 1 }],
    presentationVariants: [{
      _id: variantId,
      key: "default",
      label: "Default",
      presentationAspects: [{ definitionId: "aspect-story", weight: 1 }],
      representations: [{
        _id: representationId,
        durationTypeDefinitionId: "duration-short",
        languageLevelDefinitionId: "language-simple",
        locale: "it-IT",
        text: "Testo",
      }],
    }],
    defaultPresentation: { variantId, representationId },
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  edition.publishedRevisionId = revision._id;
  await edition.save();
  return { item, edition, revision };
}

test("follow_current advances compatible ItemEdition dependency without rewriting authoredAgainst provenance", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Namespace = require("../models/namespace.model");
    const ItemEdition = require("../models/itemEdition.model");
    const { revalidateItemEditionNamespaceDependency } = require("../services/schemaDependencyAudit.service");

    const userId = oid();
    const namespace = await Namespace.create({ name: "Regole", ownerType: "user", ownerId: userId, createdBy: userId });
    const v1 = await createNamespaceRevision({ namespaceId: namespace._id, version: 1, userId, durationIds: ["duration-short"] });
    namespace.publishedRevisionId = v1._id;
    await namespace.save();
    const { edition, revision } = await createPublishedConsumer({ namespace, namespaceRevision: v1, userId });

    v1.status = "superseded";
    await v1.save();
    const v2 = await createNamespaceRevision({ namespaceId: namespace._id, version: 2, userId, durationIds: ["duration-short", "duration-long"] });
    namespace.publishedRevisionId = v2._id;
    await namespace.save();

    const result = await revalidateItemEditionNamespaceDependency({ editionId: edition._id, force: true });
    assert.equal(result.validation.status, "valid");
    assert.equal(result.validation.outcome, "compatible");
    assert.equal(String(result.dependencyRevision._id), String(v2._id));

    const refreshed = await ItemEdition.findById(edition._id).lean();
    assert.equal(String(refreshed.namespaceDependency.validation.dependencyRevisionId), String(v2._id));
    assert.equal(String(revision.authoredAgainstNamespaceRevisionId), String(v1._id));
    assert.equal(String(refreshed.publishedRevisionId), String(revision._id));
  });
});

test("follow_current marks a real breaking ItemEdition dependency as needs_review", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Namespace = require("../models/namespace.model");
    const { revalidateItemEditionNamespaceDependency } = require("../services/schemaDependencyAudit.service");

    const userId = oid();
    const namespace = await Namespace.create({ name: "Regole breaking", ownerType: "user", ownerId: userId, createdBy: userId });
    const v1 = await createNamespaceRevision({ namespaceId: namespace._id, version: 1, userId, durationIds: ["duration-short"] });
    namespace.publishedRevisionId = v1._id;
    await namespace.save();
    const { edition } = await createPublishedConsumer({ namespace, namespaceRevision: v1, userId });

    v1.status = "superseded";
    await v1.save();
    const v2 = await createNamespaceRevision({ namespaceId: namespace._id, version: 2, userId, durationIds: ["duration-long"] });
    namespace.publishedRevisionId = v2._id;
    await namespace.save();

    const result = await revalidateItemEditionNamespaceDependency({ editionId: edition._id, force: true });
    assert.equal(result.validation.status, "needs_review");
    assert.equal(result.validation.outcome, "requires_review");
    assert.ok(result.validation.issues.some((issue) => String(issue.code || "").includes("DURATION")));
  });
});

test("pinned ItemEdition keeps its authorized superseded NamespaceRevision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Namespace = require("../models/namespace.model");
    const ItemEdition = require("../models/itemEdition.model");
    const { evaluateItemRevisionNamespaceDependency } = require("../services/schemaDependencyAudit.service");

    const userId = oid();
    const namespace = await Namespace.create({ name: "Regole pinned", ownerType: "user", ownerId: userId, createdBy: userId });
    const v1 = await createNamespaceRevision({ namespaceId: namespace._id, version: 1, userId, durationIds: ["duration-short"] });
    namespace.publishedRevisionId = v1._id;
    await namespace.save();
    const { edition, revision } = await createPublishedConsumer({ namespace, namespaceRevision: v1, userId });

    edition.namespaceDependency = { versionPolicy: "pinned", pinnedRevisionId: v1._id, validation: null };
    await edition.save();
    v1.status = "superseded";
    await v1.save();
    const v2 = await createNamespaceRevision({ namespaceId: namespace._id, version: 2, userId, durationIds: ["duration-long"] });
    namespace.publishedRevisionId = v2._id;
    await namespace.save();

    const result = await evaluateItemRevisionNamespaceDependency({ editionId: edition._id, itemRevisionId: revision._id });
    assert.equal(result.validation.status, "valid");
    assert.equal(String(result.dependencyRevision._id), String(v1._id));

    const refreshed = await ItemEdition.findById(edition._id).lean();
    assert.equal(refreshed.namespaceDependency.versionPolicy, "pinned");
    assert.equal(String(refreshed.namespaceDependency.pinnedRevisionId), String(v1._id));
  });
});
