const mongoose = require("mongoose");
function toPlain(value) { return value?.toObject ? value.toObject() : structuredClone(value || {}); }
function clonePresentationForFork(revision) {
  const source = toPlain(revision); const variantIdMap = new Map(); const representationIdMap = new Map();
  const presentationVariants = (source.presentationVariants || []).map((variant) => {
    const oldVariantId = String(variant._id); const newVariantId = new mongoose.Types.ObjectId(); variantIdMap.set(oldVariantId, newVariantId);
    const representations = (variant.representations || []).map((representation) => { const oldId = String(representation._id); const newId = new mongoose.Types.ObjectId(); representationIdMap.set(oldId, newId); return { ...representation, _id: newId }; });
    return { ...variant, _id: newVariantId, representations };
  });
  const oldDefault = source.defaultPresentation || null;
  return { presentationVariants, defaultPresentation: oldDefault ? { variantId: variantIdMap.get(String(oldDefault.variantId)) || null, representationId: representationIdMap.get(String(oldDefault.representationId)) || null } : null };
}
function definitionSets(namespaceRevision) { const set = (values) => new Set((values || []).map((entry) => String(entry.definitionId))); return { durations: set(namespaceRevision?.durationTypes), languageLevels: set(namespaceRevision?.languageLevels), presentationAspects: set(namespaceRevision?.presentationAspects), selectionSignals: set(namespaceRevision?.selectionSignals) }; }
function validatePresentationAgainstNamespace(revision, namespaceRevision) {
  const issues = []; const add = (field, code, message) => issues.push({ field, code, message, severity: "error" }); const defs = definitionSets(namespaceRevision); const variantIds = new Set(); const representationIds = new Set(); const variantKeys = new Set();
  (revision.presentationVariants || []).forEach((variant, vi) => {
    const base = `presentationVariants[${vi}]`; const variantId = String(variant._id || ""); if (variantId) variantIds.add(variantId);
    if (!variant.key) add(`${base}.key`, "REQUIRED", "key e obbligatoria"); else if (variantKeys.has(variant.key)) add(`${base}.key`, "DUPLICATE_KEY", "variant key duplicata"); else variantKeys.add(variant.key);
    const aspectSeen = new Set(); (variant.presentationAspects || []).forEach((aspect, ai) => { const id = String(aspect.definitionId); if (!defs.presentationAspects.has(id)) add(`${base}.presentationAspects[${ai}].definitionId`, "UNKNOWN_PRESENTATION_ASPECT", "PresentationAspect non presente nella NamespaceRevision"); if (aspectSeen.has(id)) add(`${base}.presentationAspects[${ai}].definitionId`, "DUPLICATE_DEFINITION", "PresentationAspect duplicato"); aspectSeen.add(id); });
    const combinations = new Set(); (variant.representations || []).forEach((representation, ri) => { const path = `${base}.representations[${ri}]`; const rid = String(representation._id || ""); if (rid) representationIds.add(rid); if (!defs.durations.has(String(representation.durationTypeDefinitionId))) add(`${path}.durationTypeDefinitionId`, "UNKNOWN_DURATION_TYPE", "DurationType non presente nella NamespaceRevision"); if (!defs.languageLevels.has(String(representation.languageLevelDefinitionId))) add(`${path}.languageLevelDefinitionId`, "UNKNOWN_LANGUAGE_LEVEL", "LanguageLevel non presente nella NamespaceRevision"); if (!representation.locale) add(`${path}.locale`, "REQUIRED", "locale e obbligatorio"); if (!representation.text) add(`${path}.text`, "REQUIRED", "text e obbligatorio"); const combo = `${representation.durationTypeDefinitionId}::${representation.languageLevelDefinitionId}::${String(representation.locale || "").toLowerCase()}`; if (combinations.has(combo)) add(path, "DUPLICATE_REPRESENTATION", "Combinazione duration/languageLevel/locale duplicata nella Variant"); combinations.add(combo); });
  });
  (revision.selectionSignals || []).forEach((signal, si) => { if (!defs.selectionSignals.has(String(signal.definitionId))) add(`selectionSignals[${si}].definitionId`, "UNKNOWN_SELECTION_SIGNAL", "SelectionSignal non presente nella NamespaceRevision"); });
  if (!(revision.presentationVariants || []).length) add("presentationVariants", "EMPTY_PRESENTATION", "Almeno una PresentationVariant e obbligatoria per pubblicare");
  if (!revision.authorCredits?.filter(Boolean).length) add("authorCredits", "AUTHOR_REQUIRED", "Almeno un autore accreditato e obbligatorio per pubblicare");
  if (!revision.metadata?.license) add("metadata.license", "LICENSE_REQUIRED", "license e obbligatoria per pubblicare");
  if (!revision.defaultPresentation) add("defaultPresentation", "DEFAULT_PRESENTATION_REQUIRED", "defaultPresentation e obbligatoria"); else { const variantId = String(revision.defaultPresentation.variantId || ""); const representationId = String(revision.defaultPresentation.representationId || ""); if (!variantIds.has(variantId)) add("defaultPresentation.variantId", "UNKNOWN_DEFAULT_VARIANT", "La Variant di default non appartiene alla revisione"); if (!representationIds.has(representationId)) add("defaultPresentation.representationId", "UNKNOWN_DEFAULT_REPRESENTATION", "La Representation di default non appartiene alla revisione"); const variant = (revision.presentationVariants || []).find((entry) => String(entry._id) === variantId); if (variant && !(variant.representations || []).some((entry) => String(entry._id) === representationId)) add("defaultPresentation.representationId", "DEFAULT_REPRESENTATION_OUTSIDE_VARIANT", "La Representation di default non appartiene alla Variant di default"); }
  return issues;
}
module.exports = { clonePresentationForFork, validatePresentationAgainstNamespace, definitionSets };
