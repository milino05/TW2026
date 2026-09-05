const crypto = require("node:crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

function id(value) { return String(value?._id || value || ""); }
function pair(left, right) { return `${id(left)}:${id(right)}`; }
function stableGraphId(editorialContextId) {
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha256").update(`editorial-semantic-graph:${id(editorialContextId)}`).digest("hex").slice(0, 24),
  );
}

function migrationError(message, report) {
  const error = new Error(message);
  error.code = "EDITORIAL_INVENTORY_MIGRATION_BLOCKED";
  error.report = report;
  return error;
}

async function indexesOrEmpty(collection) {
  try { return await collection.indexes(); }
  catch (error) {
    if ([26, 48].includes(error?.code)) return [];
    throw error;
  }
}

async function migrateEditorialStudioInventory({ dryRun = false } = {}) {
  const db = mongoose.connection;
  const legacyMembershipsCollection = db.collection("contentspacememberships");
  const contentMembershipsCollection = db.collection("content_space_item_memberships_v2");
  const subjectMembershipsCollection = db.collection("content_space_subject_memberships_v2");
  const collectionMembershipsCollection = db.collection("collection_item_memberships_v2");
  const contentSpacesCollection = db.collection("contentspaces");
  const contextsCollection = db.collection("editorialcontexts");
  const graphsCollection = db.collection("semantic_graphs_v2");
  const graphRevisionsCollection = db.collection("semantic_graph_revisions_v2");
  const releasesCollection = db.collection("editorial_releases_v2");
  const editionsCollection = db.collection("item_editions_v2");
  const itemsCollection = db.collection("items_v2");

  const [legacyMemberships, existingContentMemberships, existingSubjectMemberships, existingCollectionMemberships, contexts, releases] = await Promise.all([
    legacyMembershipsCollection.find({}).toArray(),
    contentMembershipsCollection.find({}).toArray(),
    subjectMembershipsCollection.find({}).toArray(),
    collectionMembershipsCollection.find({}).toArray(),
    contextsCollection.find({}).toArray(),
    releasesCollection.find({}).toArray(),
  ]);

  const existingContentPairs = new Set(existingContentMemberships.map((entry) => pair(entry.contentSpaceId, entry.itemId)));
  const contentMembershipInserts = legacyMemberships
    .filter((entry) => !existingContentPairs.has(pair(entry.contentSpaceId, entry.itemId)))
    .map((entry) => ({
      contentSpaceId: entry.contentSpaceId,
      itemId: entry.itemId,
      addedBy: entry.addedBy,
      createdAt: entry.createdAt || new Date(),
      updatedAt: entry.updatedAt || entry.createdAt || new Date(),
    }));

  const conceptualContentMemberships = new Map();
  for (const entry of [...existingContentMemberships, ...contentMembershipInserts]) {
    conceptualContentMemberships.set(pair(entry.contentSpaceId, entry.itemId), entry);
  }
  const contentItemIds = [...new Set([...conceptualContentMemberships.values()].map((entry) => id(entry.itemId)).filter(Boolean))];
  const items = contentItemIds.length
    ? await itemsCollection.find({ _id: { $in: contentItemIds.map((value) => new mongoose.Types.ObjectId(value)) } }).toArray()
    : [];
  const itemById = new Map(items.map((entry) => [id(entry._id), entry]));
  const missingContentItemIds = contentItemIds.filter((itemId) => !itemById.has(itemId));

  const existingSubjectPairs = new Set(existingSubjectMemberships.map((entry) => pair(entry.contentSpaceId, entry.subjectId)));
  const subjectMembershipByPair = new Map();
  for (const membership of conceptualContentMemberships.values()) {
    const item = itemById.get(id(membership.itemId));
    if (!item?.primarySubjectId) continue;
    const key = pair(membership.contentSpaceId, item.primarySubjectId);
    if (existingSubjectPairs.has(key) || subjectMembershipByPair.has(key)) continue;
    subjectMembershipByPair.set(key, {
      contentSpaceId: membership.contentSpaceId,
      subjectId: item.primarySubjectId,
      addedBy: membership.addedBy,
      createdAt: membership.createdAt || new Date(),
      updatedAt: membership.updatedAt || membership.createdAt || new Date(),
    });
  }
  const subjectMembershipInserts = [...subjectMembershipByPair.values()];

  const contextsNeedingGraph = contexts.filter((context) => !context.semanticGraphId);
  const contentSpaceIds = [...new Set(contextsNeedingGraph.map((context) => id(context.contentSpaceId)).filter(Boolean))];
  const contentSpaces = contentSpaceIds.length
    ? await contentSpacesCollection.find({ _id: { $in: contentSpaceIds.map((value) => new mongoose.Types.ObjectId(value)) } }).toArray()
    : [];
  const contentSpaceById = new Map(contentSpaces.map((entry) => [id(entry._id), entry]));
  const missingContextSpaceIds = contextsNeedingGraph
    .filter((context) => !contentSpaceById.has(id(context.contentSpaceId)))
    .map((context) => id(context._id));

  const legacyGraphRevisions = await graphRevisionsCollection.find({
    semanticGraphId: { $exists: false },
    editorialContextId: { $exists: true },
  }).toArray();
  const contextById = new Map(contexts.map((entry) => [id(entry._id), entry]));
  const orphanGraphRevisionIds = legacyGraphRevisions
    .filter((revision) => !contextById.has(id(revision.editorialContextId)))
    .map((revision) => id(revision._id));
  const revisionsByContextId = new Map();
  for (const revision of legacyGraphRevisions) {
    const contextId = id(revision.editorialContextId);
    if (!revisionsByContextId.has(contextId)) revisionsByContextId.set(contextId, []);
    revisionsByContextId.get(contextId).push(revision);
  }
  const pointedRevisionIds = contextsNeedingGraph.map((context) => context.workingGraphRevisionId).filter(Boolean);
  const pointedRevisions = pointedRevisionIds.length
    ? await graphRevisionsCollection.find({ _id: { $in: pointedRevisionIds } }).toArray()
    : [];
  const pointedRevisionById = new Map(pointedRevisions.map((revision) => [id(revision._id), revision]));

  const graphPlans = contextsNeedingGraph.map((context) => {
    const revisions = (revisionsByContextId.get(id(context._id)) || []).sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
    const requestedWorkingRevision = context.workingGraphRevisionId
      ? pointedRevisionById.get(id(context.workingGraphRevisionId)) || null
      : null;
    const workingRevision = requestedWorkingRevision || revisions.at(-1) || null;
    return { context, graphId: stableGraphId(context._id), workingRevision };
  });
  const invalidWorkingRevisionContextIds = graphPlans
    .filter(({ context }) => context.workingGraphRevisionId && !pointedRevisionById.has(id(context.workingGraphRevisionId)))
    .map(({ context }) => id(context._id));

  const graphIds = graphPlans.map((entry) => entry.graphId);
  const existingGraphs = graphIds.length ? await graphsCollection.find({ _id: { $in: graphIds } }).project({ _id: 1 }).toArray() : [];
  const existingGraphIds = new Set(existingGraphs.map((entry) => id(entry._id)));
  const graphInserts = graphPlans.filter((entry) => !existingGraphIds.has(id(entry.graphId)));

  const releasesNeedingItemIds = releases.filter((release) => (
    (release.itemBindings || []).some((binding) => !binding.itemId)
  ));
  const editionIds = [...new Set(releasesNeedingItemIds.flatMap((release) => (
    (release.itemBindings || []).filter((binding) => !binding.itemId).map((binding) => id(binding.itemEditionId))
  )).filter(Boolean))];
  const editions = editionIds.length
    ? await editionsCollection.find({ _id: { $in: editionIds.map((value) => new mongoose.Types.ObjectId(value)) } }).project({ itemId: 1 }).toArray()
    : [];
  const editionById = new Map(editions.map((entry) => [id(entry._id), entry]));
  const missingBindingEditions = editionIds.filter((editionId) => !editionById.has(editionId));
  const migratedBindingsByReleaseId = new Map();
  for (const release of releases) {
    migratedBindingsByReleaseId.set(id(release._id), (release.itemBindings || []).map((binding) => ({
      ...binding,
      itemId: binding.itemId || editionById.get(id(binding.itemEditionId))?.itemId,
    })));
  }

  const existingCollectionPairs = new Set(existingCollectionMemberships.map((entry) => pair(entry.editorialContextId, entry.itemId)));
  const collectionMembershipByPair = new Map();
  const releaseById = new Map(releases.map((entry) => [id(entry._id), entry]));
  for (const context of contexts) {
    const release = releaseById.get(id(context.publishedReleaseId));
    if (!release) continue;
    for (const binding of migratedBindingsByReleaseId.get(id(release._id)) || []) {
      if (!binding.itemId) continue;
      const key = pair(context._id, binding.itemId);
      if (existingCollectionPairs.has(key) || collectionMembershipByPair.has(key)) continue;
      collectionMembershipByPair.set(key, {
        editorialContextId: context._id,
        itemId: binding.itemId,
        curationSignals: binding.curationSignals || [],
        addedBy: release.releasedBy || context.createdBy,
        updatedBy: release.releasedBy || context.createdBy,
        createdAt: release.releasedAt || release.createdAt || context.createdAt || new Date(),
        updatedAt: release.releasedAt || release.updatedAt || context.updatedAt || new Date(),
      });
    }
  }
  const collectionMembershipInserts = [...collectionMembershipByPair.values()];

  const [contextIndexes, graphRevisionIndexes] = await Promise.all([
    indexesOrEmpty(contextsCollection),
    indexesOrEmpty(graphRevisionsCollection),
  ]);
  const legacyContextIndexes = contextIndexes.filter((entry) => (
    entry.name !== "_id_" && entry.key?.contentSpaceId === 1 && entry.key?.namespaceId === 1
  ));
  const legacyGraphRevisionIndexes = graphRevisionIndexes.filter((entry) => (
    entry.name !== "_id_" && Object.prototype.hasOwnProperty.call(entry.key || {}, "editorialContextId")
  ));

  const blockers = {
    missingContentItemIds,
    missingContextSpaceIds,
    orphanGraphRevisionIds,
    invalidWorkingRevisionContextIds,
    missingBindingEditionIds: missingBindingEditions,
  };
  if (Object.values(blockers).some((entries) => entries.length)) {
    throw migrationError("Migrazione editoriale interrotta: riferimenti legacy incompleti", blockers);
  }

  const report = {
    dryRun,
    contentMemberships: contentMembershipInserts.length,
    subjectMemberships: subjectMembershipInserts.length,
    semanticGraphs: graphInserts.length,
    editorialContexts: contextsNeedingGraph.length,
    graphRevisions: legacyGraphRevisions.length,
    releases: releasesNeedingItemIds.length,
    collectionMemberships: collectionMembershipInserts.length,
    legacyIndexes: legacyContextIndexes.length + legacyGraphRevisionIndexes.length,
  };
  if (dryRun) return report;

  if (contentMembershipInserts.length) await contentMembershipsCollection.bulkWrite(contentMembershipInserts.map((document) => ({
    updateOne: {
      filter: { contentSpaceId: document.contentSpaceId, itemId: document.itemId },
      update: { $setOnInsert: document },
      upsert: true,
    },
  })));
  if (subjectMembershipInserts.length) await subjectMembershipsCollection.bulkWrite(subjectMembershipInserts.map((document) => ({
    updateOne: {
      filter: { contentSpaceId: document.contentSpaceId, subjectId: document.subjectId },
      update: { $setOnInsert: document },
      upsert: true,
    },
  })));
  if (graphInserts.length) await graphsCollection.bulkWrite(graphInserts.map(({ context, graphId, workingRevision }) => {
    const contentSpace = contentSpaceById.get(id(context.contentSpaceId));
    return {
      updateOne: {
        filter: { _id: graphId },
        update: { $setOnInsert: {
          _id: graphId,
          namespaceId: context.namespaceId,
          displayName: context.displayName,
          description: context.description || context.shortDescription || null,
          ownerType: contentSpace.ownerType,
          ownerId: contentSpace.ownerId,
          workingRevisionId: workingRevision?._id || null,
          workingVersion: Number(workingRevision?.version || 0),
          lifecycleStatus: context.lifecycleStatus || "active",
          trashedAt: context.trashedAt || null,
          trashedBy: context.trashedBy || null,
          createdBy: context.createdBy,
          createdAt: context.createdAt || new Date(),
          updatedAt: context.updatedAt || context.createdAt || new Date(),
        } },
        upsert: true,
      },
    };
  }));
  if (legacyGraphRevisions.length) await graphRevisionsCollection.bulkWrite(legacyGraphRevisions.map((revision) => {
    const context = contextById.get(id(revision.editorialContextId));
    return {
      updateOne: {
        filter: { _id: revision._id, semanticGraphId: { $exists: false } },
        update: { $set: { semanticGraphId: context.semanticGraphId || stableGraphId(context._id) }, $unset: { editorialContextId: "" } },
      },
    };
  }));
  if (contextsNeedingGraph.length) await contextsCollection.bulkWrite(graphPlans.map(({ context, graphId }) => ({
    updateOne: {
      filter: { _id: context._id, semanticGraphId: { $exists: false } },
      update: { $set: { semanticGraphId: graphId, workingVersion: Number(context.workingVersion || 0) }, $unset: { workingGraphRevisionId: "" } },
    },
  })));
  if (releasesNeedingItemIds.length) await releasesCollection.bulkWrite(releasesNeedingItemIds.map((release) => ({
    updateOne: {
      filter: { _id: release._id },
      update: { $set: { itemBindings: migratedBindingsByReleaseId.get(id(release._id)) } },
    },
  })));
  if (collectionMembershipInserts.length) await collectionMembershipsCollection.bulkWrite(collectionMembershipInserts.map((document) => ({
    updateOne: {
      filter: { editorialContextId: document.editorialContextId, itemId: document.itemId },
      update: { $setOnInsert: document },
      upsert: true,
    },
  })));

  for (const index of [...legacyContextIndexes.map((entry) => ({ collection: contextsCollection, name: entry.name })),
    ...legacyGraphRevisionIndexes.map((entry) => ({ collection: graphRevisionsCollection, name: entry.name }))]) {
    await index.collection.dropIndex(index.name);
  }
  return report;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try { console.log(JSON.stringify(await migrateEditorialStudioInventory({ dryRun: process.argv.includes("--dry-run") }), null, 2)); }
  finally { await mongoose.disconnect(); }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(JSON.stringify({ message: error.message, code: error.code, report: error.report || null }, null, 2));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrateEditorialStudioInventory, stableGraphId };
