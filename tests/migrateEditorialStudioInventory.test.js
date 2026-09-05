const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_migrate_editorial_inventory`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

test("Editorial Studio inventory migration is guarded, dry-runnable and idempotent", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    const { migrateEditorialStudioInventory, stableGraphId } = require("../scripts/migrateEditorialStudioInventory");
    const userId = new mongoose.Types.ObjectId();
    const subjectId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();
    const editionId = new mongoose.Types.ObjectId();
    const contentSpaceId = new mongoose.Types.ObjectId();
    const namespaceId = new mongoose.Types.ObjectId();
    const contextId = new mongoose.Types.ObjectId();
    const graphRevisionId = new mongoose.Types.ObjectId();
    const releaseId = new mongoose.Types.ObjectId();
    const now = new Date();

    await Promise.all([
      mongoose.connection.collection("items_v2").insertOne({
        _id: itemId, primarySubjectId: subjectId, ownerType: "user", ownerId: userId, lifecycleStatus: "active", createdBy: userId,
      }),
      mongoose.connection.collection("item_editions_v2").insertOne({
        _id: editionId, itemId, namespaceId, createdBy: userId,
      }),
      mongoose.connection.collection("contentspaces").insertOne({
        _id: contentSpaceId, name: "Archivio storico", ownerType: "user", ownerId: userId, lifecycleStatus: "active", createdBy: userId,
      }),
      mongoose.connection.collection("contentspacememberships").insertOne({
        contentSpaceId, itemId, addedBy: userId, createdAt: now, updatedAt: now,
      }),
      mongoose.connection.collection("editorialcontexts").insertOne({
        _id: contextId,
        contentSpaceId,
        namespaceId,
        displayName: "Raccolta storica",
        workingGraphRevisionId: graphRevisionId,
        publishedReleaseId: releaseId,
        lifecycleStatus: "active",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }),
      mongoose.connection.collection("semantic_graph_revisions_v2").insertOne({
        _id: graphRevisionId,
        editorialContextId: contextId,
        version: 1,
        authoredAgainstNamespaceRevisionId: new mongoose.Types.ObjectId(),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }),
      mongoose.connection.collection("editorial_releases_v2").insertOne({
        _id: releaseId,
        editorialContextId: contextId,
        version: 1,
        namespaceRevisionId: new mongoose.Types.ObjectId(),
        graphRevisionId,
        itemBindings: [{ _id: new mongoose.Types.ObjectId(), itemEditionId: editionId, itemRevisionId: new mongoose.Types.ObjectId(), curationSignals: [{ definitionId: "rilievo", weight: 0.8 }] }],
        releasedAt: now,
        releasedBy: userId,
      }),
    ]);
    await mongoose.connection.collection("editorialcontexts").createIndex({ contentSpaceId: 1, namespaceId: 1 }, { unique: true });
    await mongoose.connection.collection("semantic_graph_revisions_v2").createIndex({ editorialContextId: 1, version: 1 }, { unique: true });
    await mongoose.connection.collection("semantic_graph_revisions_v2").createIndex({ editorialContextId: 1, createdAt: -1 });

    const dryRun = await migrateEditorialStudioInventory({ dryRun: true });
    assert.deepEqual({
      contentMemberships: dryRun.contentMemberships,
      subjectMemberships: dryRun.subjectMemberships,
      semanticGraphs: dryRun.semanticGraphs,
      editorialContexts: dryRun.editorialContexts,
      graphRevisions: dryRun.graphRevisions,
      releases: dryRun.releases,
      collectionMemberships: dryRun.collectionMemberships,
      legacyIndexes: dryRun.legacyIndexes,
    }, {
      contentMemberships: 1,
      subjectMemberships: 1,
      semanticGraphs: 1,
      editorialContexts: 1,
      graphRevisions: 1,
      releases: 1,
      collectionMemberships: 1,
      legacyIndexes: 3,
    });
    assert.equal(await mongoose.connection.collection("semantic_graphs_v2").countDocuments(), 0);

    await migrateEditorialStudioInventory();
    const graphId = stableGraphId(contextId);
    const [legacyMembership, membership, subjectMembership, collectionMembership, context, graph, graphRevision, release] = await Promise.all([
      mongoose.connection.collection("contentspacememberships").findOne({ contentSpaceId, itemId }),
      mongoose.connection.collection("content_space_item_memberships_v2").findOne({ contentSpaceId, itemId }),
      mongoose.connection.collection("content_space_subject_memberships_v2").findOne({ contentSpaceId, subjectId }),
      mongoose.connection.collection("collection_item_memberships_v2").findOne({ editorialContextId: contextId, itemId }),
      mongoose.connection.collection("editorialcontexts").findOne({ _id: contextId }),
      mongoose.connection.collection("semantic_graphs_v2").findOne({ _id: graphId }),
      mongoose.connection.collection("semantic_graph_revisions_v2").findOne({ _id: graphRevisionId }),
      mongoose.connection.collection("editorial_releases_v2").findOne({ _id: releaseId }),
    ]);
    assert.ok(legacyMembership, "the migration must preserve the legacy source document");
    assert.equal(String(membership.addedBy), String(userId));
    assert.equal(String(subjectMembership.subjectId), String(subjectId));
    assert.equal(String(collectionMembership.itemId), String(itemId));
    assert.deepEqual(collectionMembership.curationSignals, [{ definitionId: "rilievo", weight: 0.8 }]);
    assert.equal(String(context.semanticGraphId), String(graphId));
    assert.equal(context.workingGraphRevisionId, undefined);
    assert.equal(String(graph.workingRevisionId), String(graphRevisionId));
    assert.equal(graph.workingVersion, 1);
    assert.equal(String(graphRevision.semanticGraphId), String(graphId));
    assert.equal(graphRevision.editorialContextId, undefined);
    assert.equal(String(release.itemBindings[0].itemId), String(itemId));

    const contextIndexes = await mongoose.connection.collection("editorialcontexts").indexes();
    const revisionIndexes = await mongoose.connection.collection("semantic_graph_revisions_v2").indexes();
    assert.equal(contextIndexes.some((entry) => entry.key?.contentSpaceId === 1 && entry.key?.namespaceId === 1), false);
    assert.equal(revisionIndexes.some((entry) => Object.prototype.hasOwnProperty.call(entry.key || {}, "editorialContextId")), false);

    const rerun = await migrateEditorialStudioInventory();
    assert.deepEqual({ ...rerun, dryRun: false }, {
      dryRun: false,
      contentMemberships: 0,
      subjectMemberships: 0,
      semanticGraphs: 0,
      editorialContexts: 0,
      graphRevisions: 0,
      releases: 0,
      collectionMemberships: 0,
      legacyIndexes: 0,
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
