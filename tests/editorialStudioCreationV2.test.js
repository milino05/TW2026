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

async function createNamespaceRevision({ NamespaceRevision, namespaceId, version, userId, status }) {
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

test("new Editorial Studio collection initializes an empty graph against the authorized pinned NamespaceRevision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");

    const contextOwner = await User.create({ username: "studio-owner-pinned", passwordHash: "hash" });
    const namespaceOwner = await User.create({ username: "studio-namespace-owner", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Namespace esterno",
      ownerType: "user",
      ownerId: namespaceOwner._id,
      createdBy: namespaceOwner._id,
    });
    const revision1 = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: namespaceOwner._id, status: "superseded" });
    const revision2 = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 2, userId: namespaceOwner._id, status: "published" });
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

    const created = await createEditorialStudioCollection({
      actorUserId: contextOwner._id,
      payload: {
        ownerType: "user",
        ownerId: contextOwner._id,
        namespaceId: namespace._id,
        displayName: "Raccolta pinned",
        shortDescription: "Test raccolta",
        newContentSpaceName: "Spazio editoriale pinned",
      },
    });

    const space = await ContentSpace.findById(created.contentSpace.id).lean();
    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const graph = await SemanticGraphRevision.findById(context.workingGraphRevisionId).lean();

    assert.ok(space);
    assert.ok(context);
    assert.ok(graph);
    assert.equal(graph.version, 1);
    assert.equal(graph.basedOnRevisionId, null);
    assert.equal(String(graph.editorialContextId), String(context._id));
    assert.equal(String(graph.authoredAgainstNamespaceRevisionId), String(revision1._id));
    assert.notEqual(String(graph.authoredAgainstNamespaceRevisionId), String(revision2._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: graph._id }), 0);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graph._id }), 0);
  });
});
