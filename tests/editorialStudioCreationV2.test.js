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

test("new Editorial Studio collection initializes an empty reusable graph against the authorized pinned NamespaceRevision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const Entitlement = require("../models/entitlement.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
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
    const semanticGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    const graphRevision = await SemanticGraphRevision.findById(semanticGraph.workingRevisionId).lean();

    assert.ok(space);
    assert.ok(context);
    assert.ok(semanticGraph);
    assert.ok(graphRevision);
    assert.equal(graphRevision.version, 1);
    assert.equal(graphRevision.basedOnRevisionId, null);
    assert.equal(String(graphRevision.semanticGraphId), String(semanticGraph._id));
    assert.equal(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision1._id));
    assert.notEqual(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision2._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: graphRevision._id }), 0);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graphRevision._id }), 0);
  });
});

test("multiple collections can reuse the same SemanticGraph while keeping independent collection state", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");

    const owner = await User.create({ username: "studio-shared-graph-owner", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Regole condivise",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const revision = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: owner._id, status: "published" });
    namespace.publishedRevisionId = revision._id;
    await namespace.save();

    const first = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        namespaceId: namespace._id,
        displayName: "Raccolta A",
        newContentSpaceName: "Spazio condiviso",
      },
    });
    const firstContext = await EditorialContext.findById(first.editorialContext.id).lean();
    const graph = await SemanticGraph.findById(firstContext.semanticGraphId).lean();

    const second = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        namespaceId: namespace._id,
        semanticGraphId: graph._id,
        contentSpaceId: first.contentSpace.id,
        displayName: "Raccolta B",
      },
    });
    const secondContext = await EditorialContext.findById(second.editorialContext.id).lean();

    assert.notEqual(String(firstContext._id), String(secondContext._id));
    assert.equal(String(firstContext.contentSpaceId), String(secondContext.contentSpaceId));
    assert.equal(String(firstContext.namespaceId), String(secondContext.namespaceId));
    assert.equal(String(firstContext.semanticGraphId), String(secondContext.semanticGraphId));
    assert.equal(await EditorialContext.countDocuments({ contentSpaceId: firstContext.contentSpaceId, namespaceId: namespace._id }), 2);
    assert.equal(await SemanticGraph.countDocuments({ _id: graph._id }), 1);
    assert.equal(await SemanticGraphRevision.countDocuments({ semanticGraphId: graph._id }), 1);
  });
});
