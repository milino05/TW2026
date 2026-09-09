const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }

function projectSemanticGraphToSubjectIds(graph, allowedSubjectIds = []) {
  const allowed = new Set(uniqueIds(allowedSubjectIds));
  const nodes = new Map([...graph.nodes.entries()].filter(([subjectId]) => allowed.has(id(subjectId))));
  const canonicalIndex = new Map();
  for (const [key, subjectIds] of graph.canonicalIndex || []) {
    const projected = new Set([...subjectIds].map(id).filter((subjectId) => allowed.has(subjectId) && nodes.has(subjectId)));
    if (projected.size) canonicalIndex.set(key, projected);
  }

  function projectEdgeMap(source) {
    const result = new Map();
    for (const [subjectId, edges] of source || []) {
      const key = id(subjectId);
      if (!allowed.has(key) || !nodes.has(key)) continue;
      const projected = (edges || []).filter((edge) => (
        allowed.has(id(edge.fromSubjectId))
        && allowed.has(id(edge.toSubjectId))
        && nodes.has(id(edge.fromSubjectId))
        && nodes.has(id(edge.toSubjectId))
      ));
      if (projected.length) result.set(key, projected);
    }
    return result;
  }

  return {
    ...graph,
    nodes,
    canonicalIndex,
    edgesFrom: projectEdgeMap(graph.edgesFrom),
    edgesTo: projectEdgeMap(graph.edgesTo),
    authoritativeEdges: (graph.authoritativeEdges || []).filter((edge) => (
      allowed.has(id(edge.sourceSubjectId))
      && allowed.has(id(edge.targetSubjectId))
      && nodes.has(id(edge.sourceSubjectId))
      && nodes.has(id(edge.targetSubjectId))
    )),
  };
}

async function resolveEditorialReleaseCollectionProjection({ release }) {
  if (!release?._id || !release.graphRevisionId) {
    throw new AppError("EditorialRelease non utilizzabile come proiezione di Raccolta", 409, [{
      code: "EDITORIAL_RELEASE_PROJECTION_UNAVAILABLE",
    }]);
  }

  const itemBindings = release.itemBindings || [];
  const editionIds = uniqueIds(itemBindings.map((binding) => binding.itemEditionId));
  const revisionIds = uniqueIds(itemBindings.map((binding) => binding.itemRevisionId));
  const [editions, revisions] = await Promise.all([
    editionIds.length ? ItemEdition.find({ _id: { $in: editionIds } }).lean() : [],
    revisionIds.length ? ItemRevisionV2.find({ _id: { $in: revisionIds } }).lean() : [],
  ]);
  const editionById = new Map(editions.map((edition) => [id(edition._id), edition]));
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemIds = uniqueIds([
    ...itemBindings.map((binding) => binding.itemId),
    ...editions.map((edition) => edition.itemId),
  ]);
  // A pinned release remains a readable snapshot even if the live Item was later trashed.
  // Lifecycle filtering belongs to live authoring, not to immutable release consumption.
  const items = itemIds.length ? await ItemV2.find({ _id: { $in: itemIds } }).lean() : [];
  const itemById = new Map(items.map((item) => [id(item._id), item]));

  const itemRows = [];
  for (const binding of itemBindings) {
    const edition = editionById.get(id(binding.itemEditionId));
    const revision = revisionById.get(id(binding.itemRevisionId));
    const boundItemId = id(binding.itemId || edition?.itemId);
    const item = itemById.get(boundItemId);
    if (!edition || !revision || !item
      || id(edition.itemId) !== boundItemId
      || id(revision.itemEditionId) !== id(edition._id)) {
      throw new AppError("EditorialRelease contiene un binding editoriale non risolvibile", 409, [{
        code: "EDITORIAL_BINDING_UNRESOLVABLE",
        context: {
          editorialReleaseId: release._id,
          itemId: binding.itemId || null,
          itemEditionId: binding.itemEditionId || null,
          itemRevisionId: binding.itemRevisionId || null,
        },
      }]);
    }
    itemRows.push({ binding, item, edition, revision });
  }

  const itemSubjectIds = uniqueIds(itemRows.map((row) => row.item.primarySubjectId));
  const fullGraph = await loadSemanticGraphRevision(release.graphRevisionId, {
    namespaceRevisionId: release.namespaceRevisionId,
  });
  const graph = projectSemanticGraphToSubjectIds(fullGraph, itemSubjectIds);
  const graphSubjectIds = [...graph.nodes.keys()];

  return {
    editorialReleaseId: release._id,
    editorialContextId: release.editorialContextId,
    namespaceRevisionId: release.namespaceRevisionId,
    graphRevisionId: release.graphRevisionId,
    itemRows,
    itemIds: uniqueIds(itemRows.map((row) => row.item._id)),
    itemSubjectIds,
    graphSubjectIds,
    graph,
  };
}

module.exports = {
  projectSemanticGraphToSubjectIds,
  resolveEditorialReleaseCollectionProjection,
};
