const mongoose = require("mongoose");
const { pushError, hasOwn, trimIfString, isPlainObject, normalizeKey } = require("./validation.utils");
const STOP_ROLES = ["core", "recommended", "optional"];
function normalizeTransition(t) { if (!isPlainObject(t)) return t; return { fromStopIndex: Number(t.fromStopIndex), toStopIndex: Number(t.toStopIndex), type: trimIfString(t.type), layoutRevisionId: t.layoutRevisionId || null, plannedPath: Array.isArray(t.plannedPath) ? t.plannedPath : [], instructionOverride: trimIfString(t.instructionOverride), communityNote: trimIfString(t.communityNote), estimatedTransferSeconds: t.estimatedTransferSeconds == null ? null : Number(t.estimatedTransferSeconds) }; }
function normalizeVisitPayload(payload = {}) {
  const n = {}; ["kind", "title", "description"].forEach((field) => { if (hasOwn(payload, field)) n[field] = trimIfString(payload[field]); });
  if (hasOwn(payload, "ownerMuseumId")) n.ownerMuseumId = payload.ownerMuseumId;
  if (hasOwn(payload, "defaultPresentationPolicy")) n.defaultPresentationPolicy = isPlainObject(payload.defaultPresentationPolicy) ? { durationKey: normalizeKey(payload.defaultPresentationPolicy.durationKey), languageLevelKey: normalizeKey(payload.defaultPresentationPolicy.languageLevelKey) } : payload.defaultPresentationPolicy;
  if (hasOwn(payload, "stops")) n.stops = Array.isArray(payload.stops) ? payload.stops.map((stop) => isPlainObject(stop) ? { itemId: stop.itemId, role: normalizeKey(stop.role || "recommended") } : stop) : payload.stops;
  if (hasOwn(payload, "logistics")) n.logistics = isPlainObject(payload.logistics) ? { preVisitNotes: Array.isArray(payload.logistics.preVisitNotes) ? payload.logistics.preVisitNotes.map(trimIfString).filter(Boolean) : [], transitions: Array.isArray(payload.logistics.transitions) ? payload.logistics.transitions.map(normalizeTransition) : [] } : payload.logistics;
  return n;
}
function validateVisitDraftPayload({ payload, kind, mode = "create" }) {
  const errors = [], effectiveKind = payload.kind || kind;
  if (mode === "create" && !["official", "community"].includes(effectiveKind)) pushError(errors, "kind", "INVALID_ENUM", "kind deve essere official oppure community");
  if ((mode === "create" || hasOwn(payload, "title")) && (!payload.title || typeof payload.title !== "string")) pushError(errors, "title", "REQUIRED", "title e obbligatorio");
  if (effectiveKind === "official") {
    if (mode === "create" && !mongoose.isValidObjectId(payload.ownerMuseumId)) pushError(errors, "ownerMuseumId", "REQUIRED", "ownerMuseumId e obbligatorio per una visita ufficiale");
    if (!isPlainObject(payload.defaultPresentationPolicy)) pushError(errors, "defaultPresentationPolicy", "REQUIRED", "La policy di default e obbligatoria per una visita ufficiale");
    else { if (!payload.defaultPresentationPolicy.durationKey) pushError(errors, "defaultPresentationPolicy.durationKey", "REQUIRED", "durationKey e obbligatoria"); if (!payload.defaultPresentationPolicy.languageLevelKey) pushError(errors, "defaultPresentationPolicy.languageLevelKey", "REQUIRED", "languageLevelKey e obbligatoria"); }
  }
  if (effectiveKind === "community" && payload.defaultPresentationPolicy != null) pushError(errors, "defaultPresentationPolicy", "FORBIDDEN_FIELD", "Le visite community usano preferenze astratte e default locali");
  if (!Array.isArray(payload.stops)) pushError(errors, "stops", "INVALID_TYPE", "stops deve essere un array");
  else payload.stops.forEach((stop, index) => { if (!isPlainObject(stop)) pushError(errors, `stops[${index}]`, "INVALID_TYPE", "Ogni tappa deve essere un oggetto"); else { if (!mongoose.isValidObjectId(stop.itemId)) pushError(errors, `stops[${index}].itemId`, "INVALID_OBJECT_ID", "itemId deve essere un ObjectId valido"); if (!STOP_ROLES.includes(stop.role || "recommended")) pushError(errors, `stops[${index}].role`, "INVALID_ENUM", "role deve essere core, recommended oppure optional", { allowedValues: STOP_ROLES }); if (hasOwn(stop, "optional")) pushError(errors, `stops[${index}].optional`, "REMOVED_FIELD", "Usare role invece di optional"); } });
  if (payload.logistics != null) {
    if (!isPlainObject(payload.logistics)) pushError(errors, "logistics", "INVALID_TYPE", "logistics deve essere un oggetto");
    else if (Array.isArray(payload.logistics.transitions)) payload.logistics.transitions.forEach((transition, index) => { const field = `logistics.transitions[${index}]`; if (!isPlainObject(transition)) return pushError(errors, field, "INVALID_TYPE", "La transizione deve essere un oggetto"); if (!Number.isInteger(transition.fromStopIndex) || !Number.isInteger(transition.toStopIndex) || transition.toStopIndex !== transition.fromStopIndex + 1) pushError(errors, field, "INVALID_STOP_INDEX", "La transizione deve collegare due tappe consecutive"); if (!["indoor", "inter_venue"].includes(transition.type)) pushError(errors, `${field}.type`, "INVALID_ENUM", "type deve essere indoor oppure inter_venue"); });
  }
  return errors;
}
module.exports = { STOP_ROLES, normalizeVisitPayload, validateVisitDraftPayload };
