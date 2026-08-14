const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const { pushError } = require("./validation.utils");
const { validatePresentationVariants } = require("./item.validation");
const { validateSemanticEdges } = require("./semanticEdge.validation");
const { getEdgesForRevision } = require("../semanticEdge.service");
const { validateSemanticRefs } = require("./vocabulary.validation");

async function validateVariantAdaptiveMetadata({ variants, vocabulary, museumId, errors }) {
  const itemTypes = new Set(vocabulary.itemTypes || []), relationTypes = new Set((vocabulary.relationTypes || []).map((entry) => entry.key)), aspects = new Set((vocabulary.presentationAspects || []).map((entry) => entry.key)), signals = new Set((vocabulary.selectionSignals || []).map((entry) => entry.key));
  for (let index = 0; index < (variants || []).length; index += 1) {
    const variant = variants[index], path = `presentationVariants[${index}]`, audience = variant.audienceSuitability;
    if (audience) {
      for (const field of ["minMaturity", "maxMaturity"]) if (audience[field] != null && (!Number.isFinite(audience[field]) || audience[field] < 0 || audience[field] > 1)) pushError(errors, `${path}.audienceSuitability.${field}`, "INVALID_NUMBER", `${field} deve essere tra 0 e 1`);
      for (const field of ["minAgeYears", "maxAgeYears"]) if (audience[field] != null && (!Number.isFinite(audience[field]) || audience[field] < 0 || audience[field] > 130)) pushError(errors, `${path}.audienceSuitability.${field}`, "INVALID_NUMBER", `${field} non valido`);
      if (audience.minAgeYears != null && audience.maxAgeYears != null && audience.minAgeYears > audience.maxAgeYears) pushError(errors, `${path}.audienceSuitability`, "INVALID_RANGE", "minAgeYears non puo superare maxAgeYears");
      if (audience.minMaturity != null && audience.maxMaturity != null && audience.minMaturity > audience.maxMaturity) pushError(errors, `${path}.audienceSuitability`, "INVALID_RANGE", "minMaturity non puo superare maxMaturity");
    }
    for (let r = 0; r < (variant.knowledgeRequirements || []).length; r += 1) {
      const requirement = variant.knowledgeRequirements[r], feature = requirement?.feature || {}, rp = `${path}.knowledgeRequirements[${r}]`;
      if (!feature.kind) { pushError(errors, `${rp}.feature.kind`, "REQUIRED", "kind e obbligatorio"); continue; }
      if (!Number.isFinite(requirement.minLevel) || !Number.isFinite(requirement.maxLevel) || requirement.minLevel < 0 || requirement.maxLevel > 1 || requirement.minLevel > requirement.maxLevel) pushError(errors, rp, "INVALID_KNOWLEDGE_RANGE", "Intervallo di competenza non valido");
      if (!Number.isFinite(requirement.weight) || requirement.weight < 0 || requirement.weight > 1) pushError(errors, `${rp}.weight`, "INVALID_NUMBER", "weight deve essere tra 0 e 1");
      if (feature.kind === "item_type" && !itemTypes.has(feature.key)) pushError(errors, `${rp}.feature.key`, "UNKNOWN_ITEM_TYPE", `itemType non presente: ${feature.key}`);
      if (feature.kind === "relation_type" && !relationTypes.has(feature.key)) pushError(errors, `${rp}.feature.key`, "UNKNOWN_RELATION_TYPE", `relationType non presente: ${feature.key}`);
      if (feature.kind === "presentation_aspect" && !aspects.has(feature.key)) pushError(errors, `${rp}.feature.key`, "UNKNOWN_PRESENTATION_ASPECT", `PresentationAspect non presente: ${feature.key}`);
      if (feature.kind === "selection_signal" && !signals.has(feature.key)) pushError(errors, `${rp}.feature.key`, "UNKNOWN_SELECTION_SIGNAL", `SelectionSignal non presente: ${feature.key}`);
      if (feature.kind === "canonical" && (!feature.scheme || !feature.refId)) pushError(errors, `${rp}.feature`, "SEMANTIC_REF_REQUIRED", "feature canonical richiede scheme e refId");
      if (feature.kind === "item") {
        if (!mongoose.isValidObjectId(feature.itemId)) pushError(errors, `${rp}.feature.itemId`, "INVALID_OBJECT_ID", "itemId non valido");
        else if (!(await Item.exists({ _id: feature.itemId, museumId, lifecycleStatus: "active" }))) pushError(errors, `${rp}.feature.itemId`, "TARGET_NOT_FOUND", "Item di competenza non presente nel museo");
      }
    }
  }
}

async function computeItemIntegrityIssues({ item, revision, museumId, vocabulary }) {
  const errors = [];
  if (!item || String(item.museumId) !== String(museumId)) { pushError(errors, "itemId", "ITEM_MUSEUM_MISMATCH", "L'item non appartiene al museo"); return errors; }
  if (item.lifecycleStatus === "trashed") pushError(errors, "lifecycleStatus", "ITEM_TRASHED", "Un item nel cestino non puo essere pubblicato");
  if (!vocabulary.itemTypes.includes(item.itemType)) pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", "itemType non presente nel vocabolario", { allowedValues: vocabulary.itemTypes });
  if (!revision?.label) pushError(errors, "label", "REQUIRED", "label e obbligatoria");
  if (!revision?.metadata?.license) pushError(errors, "metadata.license", "REQUIRED", "La licenza e obbligatoria per pubblicare");
  validateSemanticRefs(revision?.semanticRefs || [], "semanticRefs", errors);
  const signalKeys = new Set((vocabulary.selectionSignals || []).map((entry) => entry.key)), signalSeen = new Set();
  for (let index = 0; index < (revision?.selectionSignals || []).length; index += 1) { const signal = revision.selectionSignals[index], path = `selectionSignals[${index}]`; if (!signalKeys.has(signal.key)) pushError(errors, `${path}.key`, "UNKNOWN_SELECTION_SIGNAL", `SelectionSignal non presente: ${signal.key}`); if (signalSeen.has(signal.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", "SelectionSignal duplicato"); signalSeen.add(signal.key); if (!Number.isFinite(signal.weight) || signal.weight < 0 || signal.weight > 1) pushError(errors, `${path}.weight`, "INVALID_NUMBER", "weight deve essere tra 0 e 1"); }
  const variants = revision?.presentationVariants || [];
  if (!Array.isArray(variants) || !variants.length) pushError(errors, "presentationVariants", "EMPTY_ARRAY", "Almeno una PresentationVariant e obbligatoria");
  else { await validatePresentationVariants({ museumId, variants, defaultPresentation: revision.defaultPresentation, vocabulary, errors, requireDefault: true, requirePublishedTargets: true }); await validateVariantAdaptiveMetadata({ variants, vocabulary, museumId, errors }); }
  const semanticEdges = await getEdgesForRevision(revision?._id);
  await validateSemanticEdges({ museumId, itemType: item.itemType, itemId: item._id, edges: semanticEdges, vocabulary, errors, requirePublishedTargets: true });
  return errors;
}
module.exports = { computeItemIntegrityIssues, validateVariantAdaptiveMetadata };
