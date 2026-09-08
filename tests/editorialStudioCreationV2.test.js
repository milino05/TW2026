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

test("new Editorial Studio collection initializes an empty local graph against the authorized pinned NamespaceRevision", { skip: !mongoUri }, async () => {
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
    const namespace = await Namespace.create({ name: "Namespace esterno", ownerType: "user", ownerId: namespaceOwner._id, createdBy: namespaceOwner._id });
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
    const contentSpace = await ContentSpace.create({ name: "Spazio editoriale pinned", ownerType: "user", ownerId: contextOwner._id, createdBy: contextOwner._id });

    const created = await createEditorialStudioCollection({
      actorUserId: contextOwner._id,
      payload: {
        ownerType: "user",
        ownerId: contextOwner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "new",
        graphDisplayName: "Grafo raccolta pinned",
        displayName: "Raccolta pinned",
      },
    });

    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const semanticGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    const graphRevision = await SemanticGraphRevision.findById(semanticGraph.workingRevisionId).lean();
    assert.ok(context);
    assert.ok(semanticGraph);
    assert.equal(graphRevision.version, 1);
    assert.equal(graphRevision.basedOnRevisionId, null);
    assert.equal(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision1._id));
    assert.notEqual(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision2._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: graphRevision._id }), 0);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graphRevision._id }), 0);
  });
});

test("importing an existing graph creates an independent local graph and pins the source revision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");

    const owner = await User.create({ username: "studio-import-owner", passwordHash: "hash" });
    const namespace = await Namespace.create({ name: "Regole import", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: owner._id, status: "published" });
    namespace.publishedRevisionId = revision._id;
    await namespace.save();
    const contentSpace = await ContentSpace.create({ name: "Spazio import", ownerType: "user", ownerId: owner._id, createdBy: owner._id });

    const sourceCollection = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "new",
        graphDisplayName: "Grafo sorgente",
        displayName: "Raccolta sorgente",
      },
    });
    const sourceContext = await EditorialContext.findById(sourceCollection.editorialContext.id).lean();
    const sourceGraph = await SemanticGraph.findById(sourceContext.semanticGraphId).lean();

    const importedCollection = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "import",
        semanticGraphId: sourceGraph._id,
        importItemIds: [],
        displayName: "Raccolta importata",
      },
    });
    const importedContext = await EditorialContext.findById(importedCollection.editorialContext.id).lean();
    const importedGraph = await SemanticGraph.findById(importedContext.semanticGraphId).lean();
    const source = await EditorialGraphImportSource.findOne({ editorialContextId: importedContext._id }).lean();

    assert.notEqual(String(importedContext.semanticGraphId), String(sourceGraph._id));
    assert.equal(await SemanticGraph.countDocuments({ namespaceId: namespace._id }), 2);
    assert.equal(await SemanticGraphRevision.countDocuments({ semanticGraphId: sourceGraph._id }), 1);
    assert.equal(await SemanticGraphRevision.countDocuments({ semanticGraphId: importedGraph._id }), 1);
    assert.equal(String(source.sourceSemanticGraphId), String(sourceGraph._id));
    assert.equal(String(source.sourceGraphRevisionId), String(sourceGraph.workingRevisionId));
    assert.equal(String(source.targetSemanticGraphId), String(importedGraph._id));
    assert.equal(importedCollection.semanticGraph.mode, "import");
    assert.equal(importedCollection.semanticGraph.importedSubjectCount, 0);
  });
});

test("reusable graph choices remain scoped to principal and Namespace without live collection sharing", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { createEditorialStudioCollection, listReusableSemanticGraphs } = require("../services/editorialStudioCreationV2.service");

    const owner = await User.create({ username: "studio-graph-choice-owner", passwordHash: "hash" });
    const otherOwner = await User.create({ username: "studio-graph-choice-other", passwordHash: "hash" });
    const namespace = await Namespace.create({ name: "Regole grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: owner._id, status: "published" });
    namespace.publishedRevisionId = revision._id;
    await namespace.save();
    const contentSpace = await ContentSpace.create({ name: "Spazio grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });

    const first = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "new",
        graphDisplayName: "Rinascimento sorgente",
        displayName: "Rinascimento",
      },
    });
    const firstContext = await EditorialContext.findById(first.editorialContext.id).lean();
    await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "import",
        semanticGraphId: firstContext.semanticGraphId,
        importItemIds: [],
        displayName: "Seconda raccolta",
      },
    });
    await SemanticGraph.create({ namespaceId: namespace._id, displayName: "Rinascimento altro utente", ownerType: "user", ownerId: otherOwner._id, createdBy: otherOwner._id });

    const choices = await listReusableSemanticGraphs({
      actorUserId: owner._id,
      ownerType: "user",
      ownerId: owner._id,
      namespaceId: namespace._id,
      contentSpaceId: contentSpace._id,
      query: "Rinascimento",
      page: 1,
      limit: 10,
    });

    assert.equal(choices.pagination.total, 1);
    assert.equal(choices.results.length, 1);
    assert.equal(String(choices.results[0].id), String(firstContext.semanticGraphId));
    assert.equal(choices.results[0].collectionUsageCount, 1);
    assert.equal(choices.results[0].subjectCount, 0);
    assert.equal(choices.results[0].relationCount, 0);
  });
});
