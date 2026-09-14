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

async function namespaceRevision({ namespaceId, version, userId, status, durationId }) {
  const NamespaceRevision = require("../models/namespaceRevision.model");
  return NamespaceRevision.create({
    namespaceId,
    version,
    durationTypes: [{ definitionId: durationId, key: `d${version}`, label: `Durata ${version}`, targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
    presentationAspects: [{ definitionId: "aspect-story", key: "story", label: "Racconto" }],
    selectionSignals: [{ definitionId: "signal-core", key: "core", label: "Principale" }],
    relationTypes: [],
    subjectClasses: [],
    status,
    integrity: {
      status: status === "draft" ? "needs_review" : "valid",
      issues: [],
      checkedAt: status === "draft" ? null : new Date(),
      checkedBy: status === "draft" ? null : userId,
    },
    publication: status === "draft" ? {} : { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
}

test("Item authoring projects the effective published NamespaceRevision, never authoredAgainst provenance or a working draft", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const { getItemAuthoringProjection } = require("../services/itemAuthoringV2.service");

    const user = await User.create({ username: "dependency-author", passwordHash: "hash" });
    const subject = await Subject.create({ preferredLabel: "Opera", createdBy: user._id });
    const namespace = await Namespace.create({ name: "Regole", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const v1 = await namespaceRevision({ namespaceId: namespace._id, version: 1, userId: user._id, status: "superseded", durationId: "duration-short" });
    const v2 = await namespaceRevision({ namespaceId: namespace._id, version: 2, userId: user._id, status: "published", durationId: "duration-short" });
    const v3Draft = await namespaceRevision({ namespaceId: namespace._id, version: 3, userId: user._id, status: "draft", durationId: "duration-draft-only" });
    namespace.publishedRevisionId = v2._id;
    namespace.workingRevisionId = v3Draft._id;
    await namespace.save();

    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const edition = await ItemEdition.create({
      itemId: item._id,
      namespaceId: namespace._id,
      namespaceDependency: { versionPolicy: "follow_current", pinnedRevisionId: null, validation: null },
      createdBy: user._id,
    });
    const variantId = oid();
    const representationId = oid();
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: v1._id,
      label: "Contenuto",
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
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();

    const projection = await getItemAuthoringProjection({ itemId: item._id, editionId: edition._id, actorUserId: user._id });
    assert.equal(String(projection.selected.revision.authoredAgainstNamespaceRevisionId), String(v1._id));
    assert.equal(String(projection.selected.namespace.revision.id), String(v2._id));
    assert.notEqual(String(projection.selected.namespace.revision.id), String(v3Draft._id));
    assert.equal(projection.selected.edition.namespaceDependency.versionPolicy, "follow_current");
  });
});
