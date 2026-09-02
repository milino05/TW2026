const EditorialContext = require("../models/editorialContext.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const Namespace = require("../models/namespace.model");
const { listContentSpaces, assertCanManageContentSpace } = require("./contentSpace.service");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function editableSpaces({ actorUserId, ownerType = null, ownerId = null }) {
  const spaces = await listContentSpaces({ actorUserId, ownerType, ownerId });
  const editable = [];
  for (const space of spaces) {
    try {
      await assertCanManageContentSpace(space, actorUserId, "semantic_graph.edit");
      editable.push(space);
    } catch (error) {
      if (error?.status !== 403) throw error;
    }
  }
  return editable;
}

async function listEditorialRelationChoices({
  actorUserId,
  ownerType = null,
  ownerId = null,
  query = "",
  page = 1,
  limit = 12,
}) {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(48, Number(limit) || 12));
  const normalizedQuery = String(query || "").trim();
  const spaces = await editableSpaces({ actorUserId, ownerType, ownerId });
  if (!spaces.length) {
    return { results: [], pagination: { page: normalizedPage, limit: normalizedLimit, total: 0, totalPages: 0 } };
  }

  const spaceIds = spaces.map((space) => space._id);
  const filter = { contentSpaceId: { $in: spaceIds }, lifecycleStatus: "active" };
  if (normalizedQuery) {
    const regex = new RegExp(escapeRegex(normalizedQuery), "i");
    filter.$or = [{ displayName: regex }, { shortDescription: regex }, { description: regex }];
  }

  const [total, contexts] = await Promise.all([
    EditorialContext.countDocuments(filter),
    EditorialContext.find(filter)
      .sort({ displayName: 1, createdAt: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  if (!contexts.length) {
    return {
      results: [],
      pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    };
  }

  const graphIds = [...new Set(contexts.map((context) => id(context.semanticGraphId)).filter(Boolean))];
  const namespaceIds = [...new Set(contexts.map((context) => id(context.namespaceId)).filter(Boolean))];
  const contextIds = contexts.map((context) => context._id);
  const [graphs, namespaces, entryCounts, sharedCounts] = await Promise.all([
    SemanticGraph.find({ _id: { $in: graphIds }, lifecycleStatus: "active" }).select("displayName workingRevisionId workingVersion").lean(),
    Namespace.find({ _id: { $in: namespaceIds }, lifecycleStatus: "active" }).select("name").lean(),
    EditorialContextEntry.aggregate([
      { $match: { editorialContextId: { $in: contextIds } } },
      { $group: { _id: "$editorialContextId", count: { $sum: 1 } } },
    ]),
    EditorialContext.aggregate([
      { $match: { semanticGraphId: { $in: graphIds }, lifecycleStatus: "active" } },
      { $group: { _id: "$semanticGraphId", count: { $sum: 1 } } },
    ]),
  ]);

  const graphById = new Map(graphs.map((graph) => [id(graph._id), graph]));
  const namespaceById = new Map(namespaces.map((namespace) => [id(namespace._id), namespace]));
  const spaceById = new Map(spaces.map((space) => [id(space._id), space]));
  const entryCountById = new Map(entryCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));
  const sharedCountByGraphId = new Map(sharedCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));
  const workingRevisionIds = graphs.map((graph) => graph.workingRevisionId).filter(Boolean);
  const edgeCounts = workingRevisionIds.length
    ? await SemanticEdgeV2.aggregate([
      { $match: { graphRevisionId: { $in: workingRevisionIds } } },
      { $group: { _id: "$graphRevisionId", count: { $sum: 1 } } },
    ])
    : [];
  const edgeCountByRevisionId = new Map(edgeCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));

  return {
    results: contexts.map((context) => {
      const graph = graphById.get(id(context.semanticGraphId));
      const space = spaceById.get(id(context.contentSpaceId));
      const namespace = namespaceById.get(id(context.namespaceId));
      return {
        id: context._id,
        name: context.displayName,
        shortDescription: context.shortDescription || null,
        contentSpace: { id: context.contentSpaceId, name: space?.name || "Spazio editoriale" },
        namespace: { id: context.namespaceId, name: namespace?.name || "Regole editoriali" },
        semanticGraph: {
          id: context.semanticGraphId,
          name: graph?.displayName || "Grafo semantico",
          workingVersion: Number(graph?.workingVersion || 0),
          sharedByCollections: sharedCountByGraphId.get(id(context.semanticGraphId)) || 1,
        },
        itemCount: entryCountById.get(id(context._id)) || 0,
        relationCount: graph?.workingRevisionId ? edgeCountByRevisionId.get(id(graph.workingRevisionId)) || 0 : 0,
      };
    }),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
  };
}

module.exports = { listEditorialRelationChoices };
