const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { relationView } = require("./relationSemantics.service");
const { hasMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");

function sameId(a, b) { return String(a) === String(b); }
async function canManageMuseum(actorUserId, museumId) { if (!actorUserId) return false; const user = await getActiveUserOrFail(actorUserId); return hasMuseumRole(user, museumId, "operator"); }

async function selectedRevisionIds({ museumId, view }) {
  const items = await Item.find({ museumId, lifecycleStatus: "active", $or: [{ publishedRevisionId: { $ne: null } }, { workingRevisionId: { $ne: null } }] }).lean();
  return new Map(items.map((item) => [String(item._id), view === "working" && item.workingRevisionId ? item.workingRevisionId : item.publishedRevisionId]).filter(([, revisionId]) => revisionId));
}

async function getItemRelationsView({ museumId, itemId, actorUserId = null, view = "published" }) {
  const item = await Item.findOne({ _id: itemId, museumId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item non trovato", 404);
  const canManage = await canManageMuseum(actorUserId, museumId).catch(() => false);
  if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403);
  const revisionMap = await selectedRevisionIds({ museumId, view }), pointer = revisionMap.get(String(itemId));
  const revision = pointer ? await ItemRevision.findById(pointer).lean() : null;
  if (!revision) throw new AppError("Nessuna revisione disponibile", 404);
  const vocabulary = await getMuseumVocabulary(museumId), relationTypes = new Map(vocabulary.relationTypes.map((type) => [type.key, type]));
  const revisionIds = [...revisionMap.values()];
  const [outgoingEdges, incomingEdges, sourceItems] = await Promise.all([
    SemanticEdge.find({ sourceItemRevisionId: pointer }).lean(),
    SemanticEdge.find({ sourceItemRevisionId: { $in: revisionIds }, targetItemId: itemId }).lean(),
    Item.find({ _id: { $in: [...revisionMap.keys()] } }).lean(),
  ]);
  const sourceItemMap = new Map(sourceItems.map((source) => [String(source._id), source]));
  const sourceRevisionIds = [...new Set(incomingEdges.map((edge) => String(edge.sourceItemRevisionId)))];
  const sourceRevisions = await ItemRevision.find({ _id: { $in: sourceRevisionIds } }).select("_id label").lean();
  const sourceRevisionMap = new Map(sourceRevisions.map((source) => [String(source._id), source]));

  const outgoing = outgoingEdges.map((edge) => {
    const type = relationTypes.get(edge.relationTypeKey), semantics = relationView(type, "direct");
    return { relationId: edge._id, viewKey: semantics?.viewKey || edge.relationTypeKey, baseRelationTypeKey: edge.relationTypeKey, direction: semantics?.direction || "direct", label: semantics?.label || edge.relationTypeKey, target: edge.targetItemId, weight: edge.weight, generated: false };
  });
  const incoming = incomingEdges.map((edge) => {
    const type = relationTypes.get(edge.relationTypeKey), semantics = relationView(type, "reverse"), source = sourceItemMap.get(String(edge.sourceItemId)), sourceRevision = sourceRevisionMap.get(String(edge.sourceItemRevisionId));
    return { relationId: edge._id, viewKey: semantics?.viewKey || `${edge.relationTypeKey}:reverse`, baseRelationTypeKey: edge.relationTypeKey, direction: semantics?.direction || "reverse", label: semantics?.label || `Inverso di ${edge.relationTypeKey}`, target: edge.sourceItemId, targetLabel: sourceRevision?.label || null, targetItemType: source?.itemType || null, sourceItemId: edge.sourceItemId, weight: edge.weight, generated: true };
  });
  return { itemId: item._id, revisionId: revision._id, outgoing, incoming };
}
module.exports = { getItemRelationsView };
