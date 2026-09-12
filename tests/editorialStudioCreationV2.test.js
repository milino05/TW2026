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
  const graph = await SemanticGraph.create({ namespaceId, displayName, ownerType: "user", ownerId, createdBy: ownerId });
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

test("new Editorial Studio collection always initializes an empty local graph against the authorized pinned NamespaceRevision", { skip: !mongoUri }, async () => {
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
        displayName: "Raccolta pinned",
      },
    });

    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const semanticGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    const graphRevision = await SemanticGraphRevision.findById(semanticGraph.workingRevisionId).lean();
    assert.ok(context);
    assert.ok(semanticGraph);
    assert.equal(semanticGraph.displayName, "Raccolta pinned · grafo");
    assert.equal(graphRevision.version, 1);
    assert.equal(graphRevision.basedOnRevisionId, null);
    assert.equal(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision1._id));
    assert.notEqual(String(graphRevision.authoredAgainstNamespaceRevisionId), String(revision2._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: graphRevision._id }), 0);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graphRevision._id }), 0);
    assert.equal(created.semanticGraph.localToCollection, true);
  });
});

test("collection creation rejects graph-source and graph-configuration fields", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
    const value = new mongoose.Types.ObjectId();
    await assert.rejects(
      createEditorialStudioCollection({
        actorUserId: value,
        payload: {
          ownerType: "user",
          ownerId: value,
          contentSpaceId: new mongoose.Types.ObjectId(),
          namespaceId: new mongoose.Types.ObjectId(),
          displayName: "Raccolta",
          semanticGraphId: new mongoose.Types.ObjectId(),
        },
      }),
      (error) => error?.details?.some((detail) => detail.field === "semanticGraphId" && detail.code === "UNEXPECTED"),
    );
  });
});

test("reusable graph choices include collection-local same-namespace sources and apply exclusion sets before pagination", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const { createEditorialStudioCollection, listReusableSemanticGraphs, loadCompatibleGraph } = require("../services/editorialStudioCreationV2.service");

    const owner = await User.create({ username: "studio-graph-choice-owner", passwordHash: "hash" });
    const otherOwner = await User.create({ username: "studio-graph-choice-other", passwordHash: "hash" });
    const namespace = await Namespace.create({ name: "Regole grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await createNamespaceRevision({ NamespaceRevision, namespaceId: namespace._id, version: 1, userId: owner._id, status: "published" });
    namespace.publishedRevisionId = revision._id;
    namespace.workingRevisionId = revision._id;
    await namespace.save();
    const contentSpace = await ContentSpace.create({ name: "Spazio grafi", ownerType: "user", ownerId: owner._id, createdBy: owner._id });

    const localCollection = await createEditorialStudioCollection({
      actorUserId: owner._id,
      payload: {
        ownerType: "user",
        ownerId: owner._id,
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
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
    const resultIds = new Set(choices.results.map((entry) => String(entry.id)));
    assert.equal(resultIds.has(String(localContext.semanticGraphId)), true);
    assert.equal(resultIds.has(String(standaloneGraph._id)), true);

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
      excludeSemanticGraphIds: [localContext.semanticGraphId, standaloneGraph._id],
      query: "Rinascimento",
      page: 1,
      limit: 1,
    });
    assert.equal(excludedChoices.pagination.total, 0);
    assert.equal(excludedChoices.results.length, 0);
  });
});
