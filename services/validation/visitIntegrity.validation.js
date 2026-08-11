const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
const MuseumLayout = require("../../models/museumLayout.model");
const MuseumLayoutRevision = require("../../models/museumLayoutRevision.model");
const { getMuseumVocabulary } = require("../museumVocabulary.service");
const { resolveRoute, resolvePlannedPath } = require("../graphRouting.service");

function issue(field, code, message, severity = "error", context = {}) { return { field, code, message, severity, context }; }
async function resolveCurrentLayoutForMuseum(museumId) { const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(); if (!layout) return null; const revision = await MuseumLayoutRevision.findById(layout.publishedRevisionId).lean(); return revision ? { layout, revision } : null; }

async function validateLogistics({ revision, stopItems, issues }) {
  const transitions = revision.logistics?.transitions || [];
  const transitionKeys = new Set();
  const layoutCache = new Map();
  async function currentLayout(museumId) { const key = String(museumId); if (!layoutCache.has(key)) layoutCache.set(key, await resolveCurrentLayoutForMuseum(museumId)); return layoutCache.get(key); }

  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index]; const field = `logistics.transitions[${index}]`; const key = `${transition.fromStopIndex}:${transition.toStopIndex}`;
    if (transitionKeys.has(key)) issues.push(issue(field, "DUPLICATE_TRANSITION", "Esiste gia una transizione per questa coppia di tappe")); transitionKeys.add(key);
    if (transition.fromStopIndex < 0 || transition.toStopIndex >= revision.stops.length || transition.toStopIndex !== transition.fromStopIndex + 1) { issues.push(issue(field, "INVALID_STOP_INDEX", "La transizione deve collegare due tappe consecutive esistenti")); continue; }
    const fromItem = stopItems[transition.fromStopIndex]; const toItem = stopItems[transition.toStopIndex]; if (!fromItem || !toItem) continue;
    const sameMuseum = String(fromItem.museumId) === String(toItem.museumId);
    if (transition.type === "indoor" && !sameMuseum) { issues.push(issue(`${field}.type`, "INDOOR_CROSS_MUSEUM", "Una transizione indoor non puo collegare musei differenti")); continue; }
    if (transition.type === "inter_venue" && sameMuseum) issues.push(issue(`${field}.type`, "INTER_VENUE_SAME_MUSEUM", "Una transizione inter_venue e superflua tra item dello stesso museo", "warning"));
    if (transition.type === "inter_venue") { if (!transition.instructionOverride) issues.push(issue(`${field}.instructionOverride`, "TRANSFER_INSTRUCTION_RECOMMENDED", "E consigliata un'indicazione per il trasferimento tra musei", "warning")); continue; }
    const current = await currentLayout(fromItem.museumId);
    if (!current) { issues.push(issue(`${field}.layoutRevisionId`, "LAYOUT_NOT_AVAILABLE", "Nessun layout pubblicato disponibile per questa transizione")); continue; }
    const layoutRevision = current.revision;
    if (transition.layoutRevisionId && String(transition.layoutRevisionId) !== String(layoutRevision._id)) issues.push(issue(`${field}.layoutRevisionId`, "STALE_LAYOUT_REVISION", "La transizione riferisce una revisione layout non piu pubblicata; viene validata contro il layout corrente", "warning", { configuredLayoutRevisionId: transition.layoutRevisionId, currentLayoutRevisionId: layoutRevision._id }));
    const placements = new Map((layoutRevision.itemPlacements || []).map((placement) => [String(placement.itemId), placement]));
    const fromPlacement = placements.get(String(fromItem._id)); const toPlacement = placements.get(String(toItem._id));
    if (!fromPlacement || !toPlacement) { issues.push(issue(field, "ITEM_PLACEMENT_MISSING", "Una delle tappe non ha una posizione nel layout pubblicato corrente")); continue; }
    if (transition.plannedPath?.length) {
      const planned = resolvePlannedPath({ connections: layoutRevision.connections, pathConnectionIds: transition.plannedPath, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId });
      if (!planned.reachable) issues.push(issue(`${field}.plannedPath`, "INVALID_PLANNED_PATH", "Il percorso pianificato non e valido sul layout pubblicato corrente"));
    }
  }

  for (let index = 0; index < stopItems.length - 1; index += 1) {
    const fromItem = stopItems[index]; const toItem = stopItems[index + 1];
    if (!fromItem || !toItem || String(fromItem.museumId) !== String(toItem.museumId)) continue;
    const current = await currentLayout(fromItem.museumId);
    if (!current) { issues.push(issue(`stops[${index}]`, "LAYOUT_NOT_AVAILABLE", "Il museo non dispone di un layout pubblicato per il routing")); continue; }
    const placements = new Map((current.revision.itemPlacements || []).map((placement) => [String(placement.itemId), placement]));
    const fromPlacement = placements.get(String(fromItem._id)); const toPlacement = placements.get(String(toItem._id));
    if (!fromPlacement || !toPlacement) { issues.push(issue(`stops[${index}]`, "ITEM_PLACEMENT_MISSING", "Le tappe consecutive devono essere localizzate nel layout pubblicato corrente")); continue; }
    const route = resolveRoute({ connections: current.revision.connections, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId });
    if (!route.reachable) issues.push(issue(`stops[${index}]`, "ROUTE_NOT_AVAILABLE", "Non esiste alcun percorso nel grafo corrente tra le due tappe consecutive"));
  }
}

async function computeVisitIntegrity({ visit, revision }) {
  const issues = []; const museumIds = new Set(); let estimatedContentSeconds = 0;
  if (!revision.title) issues.push(issue("title", "REQUIRED", "title e obbligatorio"));
  if (!Array.isArray(revision.stops) || revision.stops.length === 0) { issues.push(issue("stops", "EMPTY_ARRAY", "La visita deve contenere almeno una tappa")); return { issues, museumIds: [], estimatedContentSeconds }; }
  let officialVocabulary = null;
  if (visit.kind === "official") { officialVocabulary = await getMuseumVocabulary(visit.ownerMuseumId); const durations = new Set(officialVocabulary.durationTypes.map((entry) => entry.key)); const languages = new Set(officialVocabulary.languageLevels.map((entry) => entry.key)); if (!durations.has(revision.defaultPresentationPolicy?.durationKey)) issues.push(issue("defaultPresentationPolicy.durationKey", "INVALID_CONTROLLED_VALUE", "durationKey non appartiene al museo")); if (!languages.has(revision.defaultPresentationPolicy?.languageLevelKey)) issues.push(issue("defaultPresentationPolicy.languageLevelKey", "INVALID_CONTROLLED_VALUE", "languageLevelKey non appartiene al museo")); }
  const seenItems = new Set(); const stopItems = [];
  for (let index = 0; index < revision.stops.length; index += 1) {
    const stop = revision.stops[index]; const item = await Item.findOne({ _id: stop.itemId, lifecycleStatus: "active" }).lean(); stopItems.push(item || null);
    if (!item) { issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_AVAILABLE", "L'item non esiste o e nel cestino")); continue; }
    museumIds.add(String(item.museumId)); if (seenItems.has(String(item._id))) issues.push(issue(`stops[${index}].itemId`, "DUPLICATE_STOP", "Lo stesso item compare piu volte", "warning")); seenItems.add(String(item._id));
    if (visit.kind === "official" && String(item.museumId) !== String(visit.ownerMuseumId)) issues.push(issue(`stops[${index}].itemId`, "ITEM_FROM_DIFFERENT_MUSEUM", "Una visita ufficiale puo contenere solo item del proprio museo"));
    if (!item.publishedRevisionId) { issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_PUBLISHED", "L'item non ha una revisione pubblicata")); continue; }
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean(); if (!itemRevision || itemRevision.integrity?.status !== "valid") { issues.push(issue(`stops[${index}].itemId`, "ITEM_NOT_INTEGRAL", "La revisione pubblicata dell'item non e integra")); continue; }
    let selected = null; let vocabulary = officialVocabulary;
    if (visit.kind === "official") { selected = itemRevision.representations?.find((entry) => entry.durationKey === revision.defaultPresentationPolicy?.durationKey && entry.languageLevelKey === revision.defaultPresentationPolicy?.languageLevelKey); if (!selected) { issues.push(issue(`stops[${index}]`, "DEFAULT_POLICY_NOT_AVAILABLE", "L'item non supporta la policy ufficiale della visita")); continue; } }
    else { vocabulary = await getMuseumVocabulary(item.museumId); const defaults = (itemRevision.representations || []).filter((entry) => entry.isDefault === true); if (defaults.length !== 1) { issues.push(issue(`stops[${index}]`, "ITEM_DEFAULT_NOT_AVAILABLE", "Un item community deve avere esattamente una representation di default")); continue; } selected = defaults[0]; }
    const durationType = vocabulary.durationTypes.find((entry) => entry.key === selected.durationKey); if (durationType?.targetSeconds) estimatedContentSeconds += durationType.targetSeconds;
  }
  await validateLogistics({ revision, stopItems, issues });
  return { issues, museumIds: Array.from(museumIds), estimatedContentSeconds };
}

module.exports = { computeVisitIntegrity };
