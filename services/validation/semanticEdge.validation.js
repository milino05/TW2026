const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
const { pushError, isPlainObject } = require("./validation.utils");
const { normalizeEdgePayload } = require("../semanticEdge.service");

async function validateSemanticEdges({ museumId, itemType, itemId, edges, vocabulary, errors, requirePublishedTargets = false, field = "semanticEdges" }) {
  if (!Array.isArray(edges)) { pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`); return; }
  const types = new Map((vocabulary.relationTypes || []).map((entry) => [entry.key, entry])), seen = new Set(), counts = new Map();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index], path = `${field}[${index}]`;
    if (!isPlainObject(edge)) { pushError(errors, path, "INVALID_TYPE", "Ogni SemanticEdge deve essere un oggetto"); continue; }
    const type = types.get(edge.relationTypeKey);
    if (!type) { pushError(errors, `${path}.relationTypeKey`, "INVALID_RELATION_TYPE", "relationTypeKey non valida"); continue; }
    if (type.domain?.length && !type.domain.includes(itemType)) pushError(errors, `${path}.relationTypeKey`, "INVALID_DOMAIN", `La relazione non e applicabile a ${itemType}`);
    if (!mongoose.isValidObjectId(edge.targetItemId)) { pushError(errors, `${path}.targetItemId`, "INVALID_OBJECT_ID", "targetItemId deve essere un ObjectId valido"); continue; }
    if (String(edge.targetItemId) === String(itemId)) { pushError(errors, `${path}.targetItemId`, "SELF_RELATION", "Un item non puo riferirsi a se stesso"); continue; }
    const target = await Item.findOne({ _id: edge.targetItemId, lifecycleStatus: "active" }).lean();
    if (!target) { pushError(errors, `${path}.targetItemId`, "TARGET_NOT_FOUND", "L'item target non esiste o e nel cestino"); continue; }
    if (String(target.museumId) !== String(museumId)) pushError(errors, `${path}.targetItemId`, "CROSS_MUSEUM_TARGET", "Il target appartiene a un museo diverso");
    if (type.range?.length && !type.range.includes(target.itemType)) pushError(errors, `${path}.targetItemId`, "INVALID_RANGE", `Il target di tipo ${target.itemType} non e compatibile`);
    if (requirePublishedTargets) {
      if (!target.publishedRevisionId) pushError(errors, `${path}.targetItemId`, "TARGET_NOT_PUBLISHED", "L'item target non ha una revisione pubblicata");
      else {
        const targetRevision = await ItemRevision.findById(target.publishedRevisionId).select("_id status integrity.status").lean();
        if (!targetRevision || targetRevision.status !== "published" || targetRevision.integrity?.status !== "valid") pushError(errors, `${path}.targetItemId`, "TARGET_NOT_AVAILABLE", "La revisione pubblicata del target non e disponibile o integra");
      }
    }
    const duplicate = `${edge.relationTypeKey}::${String(edge.targetItemId)}`;
    if (seen.has(duplicate)) pushError(errors, path, "DUPLICATE_SEMANTIC_EDGE", "SemanticEdge duplicato");
    seen.add(duplicate);
    const count = counts.get(edge.relationTypeKey) || 0;
    if (type.validationRules?.allowMultiple === false && count >= 1) pushError(errors, path, "MULTIPLE_RELATIONS_NOT_ALLOWED", "Il tipo di relazione ammette un solo target");
    counts.set(edge.relationTypeKey, count + 1);
    if (!Number.isFinite(edge.weight) || edge.weight < 0 || edge.weight > 10) pushError(errors, `${path}.weight`, "INVALID_NUMBER", "weight deve essere compreso tra 0 e 10");
  }
}

module.exports = { normalizeSemanticEdges: normalizeEdgePayload, validateSemanticEdges };
