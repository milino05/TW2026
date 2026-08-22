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

async function namespaceRevision({ NamespaceRevision, namespaceId, version, userId, status }) {
  return NamespaceRevision.create({
    namespaceId,
    version,
    durationTypes: [{ definitionId: `duration-${version}`, key: `duration-${version}`, label: `Durata ${version}`, targetSeconds: 60 }],
    languageLevels: [{ definitionId: `language-${version}`, key: `language-${version}`, label: `Lingua ${version}` }],
    subjectClasses: [],
    relationTypes: [],
    presentationAspects: [],
    selectionSignals: [],
    status,
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
}

test("EditorialReleaseComposer uses the NamespaceRevision pinned by the Context owner principal instead of the current live revision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const { getEditorialReleaseComposer } = require("../services/editorialReleaseComposerV2.service");

    const contextOwner = await User.create({ username: "context-owner-pinned", passwordHash: "hash" });
    const namespaceOwner = await User.create({ username: "namespace-owner-pinned", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Namespace esterno",
      ownerType: "user",
      ownerId: namespaceOwner._id,
      createdBy: namespaceOwner._id,
    });
    const revision1 = await namespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: namespaceOwner._id, status: "superseded" });
    const revision2 = await namespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 2, userId: namespaceOwner._id, status: "published" });
    namespace.publishedRevisionId = revision2._id;
    await namespace.save();

    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: contextOwner._id,
      resourceType: "namespace",
      resourceId: namespace._id,
      capability: "namespace.author",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "namespace_revision", resourceId: revision1._id },
      status: "active",
    });

    const contentSpace = await ContentSpace.create({
      name: "Corpus pinned",
      ownerType: "user",
      ownerId: contextOwner._id,
      createdBy: contextOwner._id,
    });
    const context = await EditorialContext.create({
      contentSpaceId: contentSpace._id,
      namespaceId: namespace._id,
      displayName: "Context pinned",
      createdBy: contextOwner._id,
    });
    const graphRevision = await SemanticGraphRevision.create({
      editorialContextId: context._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: revision1._id,
      createdBy: contextOwner._id,
    });
    context.workingGraphRevisionId = graphRevision._id;
    await context.save();

    const composer = await getEditorialReleaseComposer({ editorialContextId: context._id, actorUserId: contextOwner._id });
    assert.equal(String(composer.releaseInputs.namespaceRevisionId), String(revision1._id));
    assert.notEqual(String(composer.releaseInputs.namespaceRevisionId), String(revision2._id));
    assert.equal(String(composer.releaseInputs.graphRevisionId), String(graphRevision._id));
  });
});
