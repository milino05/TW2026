const MuseumLayout = require("../../models/museumLayout.model");
const MuseumLayoutRevision = require("../../models/museumLayoutRevision.model");
const { resolveRoute, resolvePlannedPath } = require("../graphRouting.service");
function id(value) { return String(value?._id || value || ""); }
function issue(field, code, message, severity = "error") { return { field, code, message, severity, context: {} }; }
function placementMap(layoutRevision) { return new Map((layoutRevision?.itemPlacements || []).map((entry) => [id(entry.itemId), entry])); }
async function currentLayout(museumId, cache) {
  const key = id(museumId);
  if (cache.has(key)) return cache.get(key);
  const stable = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  const revision = stable ? await MuseumLayoutRevision.findById(stable.publishedRevisionId).lean() : null;
  const result = revision ? { stable, revision } : null;
  cache.set(key, result);
  return result;
}
async function validateTargetRouting({ revision, targets, issues, layoutCache = new Map() }) {
  const targetById = new Map(targets.map((entry) => [id(entry.source._id), entry]));
  const consecutive = new Set();
  for (let index = 0; index < targets.length - 1; index += 1) consecutive.add(`${id(targets[index].source._id)}>${id(targets[index + 1].source._id)}`);
  const hints = new Map();
  for (let index = 0; index < (revision.logistics?.routeHints || []).length; index += 1) {
    const hint = revision.logistics.routeHints[index], field = `logistics.routeHints[${index}]`, key = `${id(hint.fromTargetEntryId)}>${id(hint.toTargetEntryId)}`;
    if (!targetById.has(id(hint.fromTargetEntryId)) || !targetById.has(id(hint.toTargetEntryId))) { issues.push(issue(field, "ROUTE_HINT_TARGET_NOT_FOUND", "Il routeHint deve riferire target esistenti")); continue; }
    if (!consecutive.has(key)) { issues.push(issue(field, "ROUTE_HINT_NOT_CONSECUTIVE_TARGETS", "Il routeHint deve collegare target consecutivi")); continue; }
    if (hints.has(key)) issues.push(issue(field, "DUPLICATE_ROUTE_HINT", "RouteHint duplicato"));
    hints.set(key, hint);
  }
  for (let index = 0; index < targets.length - 1; index += 1) {
    const from = targets[index], to = targets[index + 1];
    if (!from.item || !to.item) continue;
    const hint = hints.get(`${id(from.source._id)}>${id(to.source._id)}`);
    if (id(from.item.museumId) !== id(to.item.museumId)) {
      if (hint?.type === "indoor") issues.push(issue(`contentEntries[${from.index}]`, "INDOOR_CROSS_MUSEUM", "Il trasferimento deve essere inter_venue"));
      if (!hint) issues.push(issue(`contentEntries[${from.index}]`, "INTER_VENUE_ROUTE_HINT_RECOMMENDED", "Definire il trasferimento e consigliato", "warning"));
      continue;
    }
    const current = await currentLayout(from.item.museumId, layoutCache);
    if (!current) { issues.push(issue(`contentEntries[${from.index}]`, "LAYOUT_NOT_AVAILABLE", "Layout non disponibile")); continue; }
    const placements = placementMap(current.revision), a = placements.get(id(from.item._id)), b = placements.get(id(to.item._id));
    if (!a || !b) continue;
    if (hint?.plannedPath?.length) {
      const planned = resolvePlannedPath({ connections: current.revision.connections, pathConnectionIds: hint.plannedPath, fromPlaceId: a.primaryPlaceId, toPlaceId: b.primaryPlaceId });
      if (!planned.reachable) issues.push(issue(`contentEntries[${from.index}]`, "INVALID_PLANNED_PATH", "Percorso pianificato non valido"));
    }
    const route = resolveRoute({ connections: current.revision.connections, fromPlaceId: a.primaryPlaceId, toPlaceId: b.primaryPlaceId });
    if (!route.reachable) issues.push(issue(`contentEntries[${from.index}]`, "ROUTE_NOT_AVAILABLE", "Percorso non disponibile"));
  }
}
module.exports = { id, issue, placementMap, currentLayout, validateTargetRouting };
