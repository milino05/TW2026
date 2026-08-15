const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { hasMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");
const {
  id,
  loadMuseumSemanticGraph,
  outgoingEdges,
  incomingEdges,
} = require("./semanticGraph.service");

async function canManageMuseum(actorUserId, museumId) {
  if (!actorUserId) return false;
  const user = await getActiveUserOrFail(actorUserId);
  return hasMuseumRole(user, museumId, "operator");
}

function relationView(graph, edge) {
  const target = graph.nodes.get(id(edge.toItemId));
  return {
    relationId: edge.edgeId || edge.relationId,
    edgeId: edge.edgeId || edge.relationId,
    viewKey: edge.viewKey,
    baseRelationTypeKey: edge.baseRelationTypeKey,
    direction: edge.direction,
    label: edge.label,
    description: edge.description,
    target: edge.toItemId,
    targetLabel: target?.revision?.label || null,
    targetItemType: target?.item?.itemType || null,
    sourceItemId: edge.generated ? edge.toItemId : edge.fromItemId,
    weight: edge.relationWeight,
    generated: edge.generated,
  };
}

async function getItemRelationsView({ museumId, itemId, actorUserId = null, view = "published" }) {
  const item = await Item.findOne({ _id: itemId, museumId, lifecycleStatus: "active" }).lean();
  if (!item) throw new AppError("Item non trovato", 404);
  const canManage = await canManageMuseum(actorUserId, museumId).catch(() => false);
  if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403);

  const graph = await loadMuseumSemanticGraph(museumId, { view: view === "working" ? "working" : "published" });
  const node = graph.nodes.get(id(itemId));
  if (!node) throw new AppError("Nessuna revisione disponibile nel grafo richiesto", 404);

  return {
    itemId: item._id,
    revisionId: node.revision._id,
    outgoing: outgoingEdges(graph, itemId).map((edge) => relationView(graph, edge)),
    incoming: incomingEdges(graph, itemId).map((edge) => relationView(graph, edge)),
  };
}

module.exports = { getItemRelationsView };
