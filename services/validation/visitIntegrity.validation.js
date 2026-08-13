const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
const { getMuseumVocabulary } = require("../museumVocabulary.service");
const { findRepresentationByPolicy, findDefaultRepresentation } = require("../presentationPolicy.service");
const { id, issue, placementMap, currentLayout, validateTargetRouting } = require("./visitTargetRouting.validation");

async function computeVisitIntegrity({ visit, revision }) {
  const issues = [], museumIds = new Set(), entries = [], vocabularies = new Map(), layoutCache = new Map();
  let estimatedContentSeconds = 0;
  if (!revision.title) issues.push(issue("title", "REQUIRED", "title e obbligatorio"));
  if (!Array.isArray(revision.contentEntries) || !revision.contentEntries.length) {
    issues.push(issue("contentEntries", "EMPTY_ARRAY", "La visita deve contenere almeno un contenuto"));
    return { issues, museumIds: [], estimatedContentSeconds };
  }
  async function vocabularyFor(museumId) {
    const key = id(museumId);
    if (!vocabularies.has(key)) vocabularies.set(key, await getMuseumVocabulary(museumId));
    return vocabularies.get(key);
  }
  let officialVocabulary = null;
  if (visit.kind === "official") {
    officialVocabulary = await vocabularyFor(visit.ownerMuseumId);
    if (!officialVocabulary.durationTypes.some((entry) => entry.key === revision.defaultPresentationPolicy?.durationKey)) issues.push(issue("defaultPresentationPolicy.durationKey", "INVALID_CONTROLLED_VALUE", "durationKey non appartiene al museo"));
    if (!officialVocabulary.languageLevels.some((entry) => entry.key === revision.defaultPresentationPolicy?.languageLevelKey)) issues.push(issue("defaultPresentationPolicy.languageLevelKey", "INVALID_CONTROLLED_VALUE", "languageLevelKey non appartiene al museo"));
  }
  const seen = new Set();
  for (let index = 0; index < revision.contentEntries.length; index += 1) {
    const source = revision.contentEntries[index], field = `contentEntries[${index}]`;
    const item = await Item.findOne({ _id: source.itemId, lifecycleStatus: "active" }).lean();
    if (!item) { issues.push(issue(`${field}.itemId`, "ITEM_NOT_AVAILABLE", "L'Item non esiste o e nel cestino")); entries.push(null); continue; }
    museumIds.add(id(item.museumId));
    if (seen.has(id(item._id))) issues.push(issue(`${field}.itemId`, "DUPLICATE_CONTENT_ENTRY", "Lo stesso Item compare piu volte", "warning"));
    seen.add(id(item._id));
    if (visit.kind === "official" && id(item.museumId) !== id(visit.ownerMuseumId)) issues.push(issue(`${field}.itemId`, "ITEM_FROM_DIFFERENT_MUSEUM", "Una visita ufficiale usa solo Item del proprio museo"));
    if (!item.publishedRevisionId) { issues.push(issue(`${field}.itemId`, "ITEM_NOT_PUBLISHED", "L'Item non e pubblicato")); entries.push({ source, item, index }); continue; }
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!itemRevision || itemRevision.integrity?.status !== "valid") { issues.push(issue(`${field}.itemId`, "ITEM_NOT_INTEGRAL", "La revisione dell'Item non e integra")); entries.push({ source, item, index }); continue; }
    const vocabulary = visit.kind === "official" ? officialVocabulary : await vocabularyFor(item.museumId);
    const type = (vocabulary.itemTypeDefinitions || []).find((entry) => entry.key === item.itemType);
    const capabilities = new Set(type?.capabilities || []);
    if (source.spatialMode === "target" && !capabilities.has("navigation_target")) issues.push(issue(`${field}.spatialMode`, "ITEM_NOT_NAVIGATION_TARGET", "Questo ItemType non puo essere una destinazione fisica"));
    if (source.spatialMode === "context" && !capabilities.has("semantic_context")) issues.push(issue(`${field}.spatialMode`, "ITEM_NOT_SEMANTIC_CONTEXT", "Questo ItemType non puo essere un contenuto contestuale"));
    const selected = visit.kind === "official" ? findRepresentationByPolicy(itemRevision, revision.defaultPresentationPolicy || {}) : findDefaultRepresentation(itemRevision);
    if (!selected) issues.push(issue(field, visit.kind === "official" ? "DEFAULT_POLICY_NOT_AVAILABLE" : "ITEM_DEFAULT_NOT_AVAILABLE", "Non esiste una representation utilizzabile"));
    else estimatedContentSeconds += vocabulary.durationTypes.find((entry) => entry.key === selected.durationKey)?.targetSeconds || 0;
    if (source.spatialMode === "target") {
      const current = await currentLayout(item.museumId, layoutCache);
      if (!current) issues.push(issue(field, "LAYOUT_NOT_AVAILABLE", "Un target richiede un layout pubblicato"));
      else if (!placementMap(current.revision).get(id(item._id))) issues.push(issue(field, "ITEM_PLACEMENT_MISSING", "Un target richiede un placement nel layout pubblicato"));
    }
    entries.push({ source, item, itemRevision, index });
  }
  const targets = entries.filter((entry) => entry?.source?.spatialMode === "target");
  await validateTargetRouting({ revision, targets, issues, layoutCache });
  return { issues, museumIds: [...museumIds], estimatedContentSeconds };
}
module.exports = { computeVisitIntegrity };
