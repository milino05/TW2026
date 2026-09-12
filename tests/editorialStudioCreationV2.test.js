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

async function createStandaloneGraph({ SemanticGraph, SemanticGraphRevision, namespaceId, namespaceRevisionId, ownerId, displayName }) {
  const graph = await SemanticGraph.create({
    namespaceId,
    displayName,
    ownerType: "user",
    ownerId,
    createdBy: ownerId,
  });
  const revision = await SemanticGraphRevision.create({
    semanticGraphId: graph._id,
    version: 1,
    basedOnRevisionId: null,
    authoredAgainstNamespaceRevisionId: namespaceRevisionId,
    createdBy: ownerId,
  });
  graph.workingRevisionId = revision._id;
  graph.workingVersion = 1;
  await graph.save();
  return { graph, revision };
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

test("importing a standalone graph creates an independent local graph and pins the source revision", { skip: !mongoUri }, async () => {
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
    const { graph: sourceGraph } = await createStandaloneGraph({
      SemanticGraph,
      SemanticGraphRevision,
      namespaceId: namespace._id,
      namespaceRevisionId: revision._id,
      ownerId: owner._id,
      displayName: "Grafo sorgente standalone",
    });

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

test("reusable graph choices include collection-local same-namespace sources and support target exclusion", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
    const { createEditorialStudioCollection, listReusableSemanticGraphs, loadCompatibleGraph } = require("../services/editorialStudioCreationV2.service");

    const owner = await User.create({ username: "studio-graph-choice-owner", passwordHash: "hash" });
    const otherOwner = await User.create({ username: "studio-graph-choice-other", passwordHash: "hash" });
    const namespace = await Namespace.create({ name: "Regole grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: owner._id, status: "published" });
    namespace.publishedRevisionId = revision._id;
    await namespace.save();
    const contentSpace = await ContentSpace.create({ name: "Spazio grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });

    const localCollection = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "new",
        graphDisplayName: "Rinascimento locale",
        displayName: "Rinascimento",
      },
    });
    const localContext = await EditorialContext.findById(localCollection.editorialContext.id).lean();
    const { graph: standaloneGraph } = await createStandaloneGraph({
      SemanticGraph,
      SemanticGraphRevision,
      namespaceId: namespace._id,
      namespaceRevisionId: revision._id,
      ownerId: owner._id,
      displayName: "Rinascimento sorgente standalone",
    });
    await createStandaloneGraph({
      SemanticGraph,
      SemanticGraphRevision,
      namespaceId: namespace._id,
      namespaceRevisionId: revision._id,
      ownerId: otherOwner._id,
      displayName: "Rinascimento altro utente",
    });

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

    assert.equal(choices.pagination.total, 2);
    assert.equal(choices.results.length, 2);
    const resultIds = new Set(choices.results.map((entry) => String(entry.id)));
    assert.equal(resultIds.has(String(localContext.semanticGraphId)), true);
    assert.equal(resultIds.has(String(standaloneGraph._id)), true);
    const localChoice = choices.results.find((entry) => String(entry.id) === String(localContext.semanticGraphId));
    assert.equal(localChoice.collectionUsageCount, 1);
    assert.equal(localChoice.usedInCurrentSpace, true);

    const compatibleLocal = await loadCompatibleGraph({
      semanticGraphId: localContext.semanticGraphId,
      ownerType: "user",
      ownerId: owner._id,
      namespaceId: namespace._id,
    });
    assert.equal(String(compatibleLocal._id), String(localContext.semanticGraphId));

    const excludedChoices = await listReusableSemanticGraphs({
      actorUserId: owner._id,
      ownerType: "user",
      ownerId: owner._id,
      namespaceId: namespace._id,
      contentSpaceId: contentSpace._id,
      excludeSemanticGraphId: localContext.semanticGraphId,
      query: "Rinascimento",
      page: 1,
      limit: 10,
    });
    assert.equal(excludedChoices.pagination.total, 1);
    assert.equal(String(excludedChoices.results[0].id), String(standaloneGraph._id));

    const clonedCollection = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        graphMode: "import",
        semanticGraphId: localContext.semanticGraphId,
        importItemIds: [],
        displayName: "Rinascimento derivato",
      },
    });
    const clonedContext = await EditorialContext.findById(clonedCollection.editorialContext.id).lean();
    const pinnedSource = await EditorialGraphImportSource.findOne({ editorialContextId: clonedContext._id }).lean();
    assert.notEqual(String(clonedContext.semanticGraphId), String(localContext.semanticGraphId));
    assert.equal(String(pinnedSource.sourceSemanticGraphId), String(localContext.semanticGraphId));
    assert.equal(String(pinnedSource.sourceGraphRevisionId), String(compatibleLocal.workingRevisionId));
  });
});