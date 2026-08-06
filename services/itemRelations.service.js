const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { hasMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");

function sameId(a, b) {
  return String(a) === String(b);
}

async function canManageMuseum(actorUserId, museumId) {
  if (!actorUserId) return false;
  const user = await getActiveUserOrFail(actorUserId);
  return hasMuseumRole(user, museumId, "operator");
}

async function getItemRelationsView({ museumId, itemId, actorUserId = null, view = "published" }) {
  const item = await Item.findOne({ _id: itemId, museumId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item non trovato", 404);

  const canManage = await canManageMuseum(actorUserId, museumId).catch(() => false);
  if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403);

  const pointer = view === "working" && item.workingRevisionId
    ? item.workingRevisionId
    : item.publishedRevisionId;
  const revision = pointer ? await ItemRevision.findById(pointer).lean() : null;
  if (!revision) throw new AppError("Nessuna revisione disponibile", 404);

  const vocabulary = await getMuseumVocabulary(museumId);
  const relationTypes = new Map(vocabulary.relationTypes.map((type) => [type.key, type]));
  const outgoing = (revision.relations || []).map((relation) => {
    const type = relationTypes.get(relation.relationTypeKey);
    return {
      relationId: relation._id,
      viewKey: relation.relationTypeKey,
      baseRelationTypeKey: relation.relationTypeKey,
      direction: type?.directionality === "symmetric" ? "symmetric" : "direct",
      label: type?.label || relation.relationTypeKey,
      target: relation.target,
      weight: relation.weight,
      generated: false,
    };
  });

  const sourceItems = await Item.find({
    museumId,
    lifecycleStatus: "active",
    $or: [{ publishedRevisionId: { $ne: null } }, { workingRevisionId: { $ne: null } }],
  }).lean();
  const incoming = [];
  for (const source of sourceItems) {
    const sourceRevisionId = view === "working" && source.workingRevisionId
      ? source.workingRevisionId
      : source.publishedRevisionId;
    if (!sourceRevisionId) continue;
    const sourceRevision = await ItemRevision.findById(sourceRevisionId).lean();
    for (const relation of sourceRevision?.relations || []) {
      if (!sameId(relation.target, itemId)) continue;
      const type = relationTypes.get(relation.relationTypeKey);
      if (!type) continue;
      const symmetric = type.directionality === "symmetric";
      incoming.push({
        relationId: relation._id,
        viewKey: symmetric ? type.key : `${type.key}:reverse`,
        baseRelationTypeKey: type.key,
        direction: symmetric ? "symmetric" : "reverse",
        label: symmetric ? type.label : type.reverse?.label || `Inverso di ${type.label}`,
        target: source._id,
        targetLabel: sourceRevision.label,
        targetItemType: source.itemType,
        sourceItemId: source._id,
        weight: relation.weight,
        generated: true,
      });
    }
  }

  return { itemId: item._id, revisionId: revision._id, outgoing, incoming };
}

module.exports = { getItemRelationsView };
