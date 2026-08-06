const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
const { getMuseumVocabulary } = require("../museumVocabulary.service");

function issue(field, code, message, severity = "error", context = {}) {
  return { field, code, message, severity, context };
}

async function computeVisitIntegrity({ visit, revision }) {
  const issues = [];
  const museumIds = new Set();
  let estimatedContentSeconds = 0;

  if (!revision.title) issues.push(issue("title", "REQUIRED", "title e obbligatorio"));
  if (!Array.isArray(revision.stops) || revision.stops.length === 0) {
    issues.push(issue("stops", "EMPTY_ARRAY", "La visita deve contenere almeno una tappa"));
    return { issues, museumIds: [], estimatedContentSeconds };
  }

  let officialVocabulary = null;
  if (visit.kind === "official") {
    officialVocabulary = await getMuseumVocabulary(visit.ownerMuseumId);
    const durations = new Set(officialVocabulary.durationTypes.map((entry) => entry.key));
    const languages = new Set(officialVocabulary.languageLevels.map((entry) => entry.key));
    if (!durations.has(revision.defaultPresentationPolicy?.durationKey)) {
      issues.push(issue("defaultPresentationPolicy.durationKey", "INVALID_CONTROLLED_VALUE", "durationKey non appartiene al museo"));
    }
    if (!languages.has(revision.defaultPresentationPolicy?.languageLevelKey)) {
      issues.push(issue("defaultPresentationPolicy.languageLevelKey", "INVALID_CONTROLLED_VALUE", "languageLevelKey non appartiene al museo"));
    }
  }

  const seenItems = new Set();
  for (let index = 0; index < revision.stops.length; index += 1) {
    const stop = revision.stops[index];
    const item = await Item.findOne({ _id: stop.itemId, lifecycleStatus: "active" }).lean();
    if (!item) {
      issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_AVAILABLE", "L'item non esiste o e nel cestino"));
      continue;
    }
    museumIds.add(String(item.museumId));
    if (seenItems.has(String(item._id))) {
      issues.push(issue(`stops[${index}].itemId`, "DUPLICATE_STOP", "Lo stesso item compare piu volte", "warning"));
    }
    seenItems.add(String(item._id));

    if (visit.kind === "official" && String(item.museumId) !== String(visit.ownerMuseumId)) {
      issues.push(issue(`stops[${index}].itemId`, "ITEM_FROM_DIFFERENT_MUSEUM", "Una visita ufficiale puo contenere solo item del proprio museo"));
    }
    if (!item.publishedRevisionId) {
      issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_PUBLISHED", "L'item non ha una revisione pubblicata"));
      continue;
    }
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!itemRevision || itemRevision.integrity?.status !== "valid") {
      issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_INTEGRAL", "La revisione pubblicata dell'item non e integra"));
      continue;
    }

    let selected = null;
    let vocabulary = officialVocabulary;
    if (visit.kind === "official") {
      selected = itemRevision.representations?.find(
        (entry) =>
          entry.durationKey === revision.defaultPresentationPolicy?.durationKey &&
          entry.languageLevelKey === revision.defaultPresentationPolicy?.languageLevelKey,
      );
      if (!selected) {
        issues.push(issue(`stops[${index}]`, "DEFAULT_POLICY_NOT_AVAILABLE", "L'item non supporta la policy ufficiale della visita"));
        continue;
      }
    } else {
      vocabulary = await getMuseumVocabulary(item.museumId);
      const defaults = (itemRevision.representations || []).filter((entry) => entry.isDefault === true);
      if (defaults.length !== 1) {
        issues.push(issue(`stops[${index}]`, "ITEM_DEFAULT_NOT_AVAILABLE", "Un item community deve avere esattamente una representation di default"));
        continue;
      }
      selected = defaults[0];
    }

    const durationType = vocabulary.durationTypes.find((entry) => entry.key === selected.durationKey);
    if (durationType?.targetSeconds) estimatedContentSeconds += durationType.targetSeconds;
  }

  return { issues, museumIds: Array.from(museumIds), estimatedContentSeconds };
}

module.exports = { computeVisitIntegrity };
