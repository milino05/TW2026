const mongoose = require("mongoose");
const { pushError, hasOwn, trimIfString, isPlainObject, normalizeKey } = require("./validation.utils");

const CONTENT_ENTRY_ROLES = ["core", "recommended", "optional"];
const SPATIAL_MODES = ["target", "context"];

function normalizeRouteHint(value) {
  if (!isPlainObject(value)) return value;
  return {
    fromTargetEntryId: value.fromTargetEntryId,
    toTargetEntryId: value.toTargetEntryId,
    type: trimIfString(value.type),
    layoutRevisionId: value.layoutRevisionId || null,
    plannedPath: Array.isArray(value.plannedPath) ? value.plannedPath : [],
    instructionOverride: trimIfString(value.instructionOverride),
    communityNote: trimIfString(value.communityNote),
    estimatedTransferSeconds: value.estimatedTransferSeconds == null ? null : Number(value.estimatedTransferSeconds),
  };
}

function normalizeVisitPayload(payload = {}) {
  const normalized = {};
  ["kind", "title", "description"].forEach((field) => {
    if (hasOwn(payload, field)) normalized[field] = trimIfString(payload[field]);
  });
  if (hasOwn(payload, "ownerMuseumId")) normalized.ownerMuseumId = payload.ownerMuseumId;
  if (hasOwn(payload, "defaultPresentationPolicy")) {
    normalized.defaultPresentationPolicy = isPlainObject(payload.defaultPresentationPolicy) ? {
      durationKey: normalizeKey(payload.defaultPresentationPolicy.durationKey),
      languageLevelKey: normalizeKey(payload.defaultPresentationPolicy.languageLevelKey),
    } : payload.defaultPresentationPolicy;
  }
  if (hasOwn(payload, "contentEntries")) {
    normalized.contentEntries = Array.isArray(payload.contentEntries) ? payload.contentEntries.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      const result = {
        itemId: entry.itemId,
        role: normalizeKey(entry.role || "recommended"),
        spatialMode: normalizeKey(entry.spatialMode),
      };
      if (entry._id) result._id = entry._id;
      return result;
    }) : payload.contentEntries;
  }
  if (hasOwn(payload, "stops")) normalized.stops = payload.stops;
  if (hasOwn(payload, "logistics")) {
    normalized.logistics = isPlainObject(payload.logistics) ? {
      preVisitNotes: Array.isArray(payload.logistics.preVisitNotes) ? payload.logistics.preVisitNotes.map(trimIfString).filter(Boolean) : [],
      routeHints: Array.isArray(payload.logistics.routeHints) ? payload.logistics.routeHints.map(normalizeRouteHint) : [],
      ...(hasOwn(payload.logistics, "transitions") ? { transitions: payload.logistics.transitions } : {}),
    } : payload.logistics;
  }
  return normalized;
}

function validateVisitDraftPayload({ payload, kind, mode = "create" }) {
  const errors = [];
  const effectiveKind = payload.kind || kind;
  if (mode === "create" && !["official", "community"].includes(effectiveKind)) pushError(errors, "kind", "INVALID_ENUM", "kind deve essere official oppure community");
  if ((mode === "create" || hasOwn(payload, "title")) && (!payload.title || typeof payload.title !== "string")) pushError(errors, "title", "REQUIRED", "title e obbligatorio");
  if (effectiveKind === "official") {
    if (mode === "create" && !mongoose.isValidObjectId(payload.ownerMuseumId)) pushError(errors, "ownerMuseumId", "REQUIRED", "ownerMuseumId e obbligatorio per una visita ufficiale");
    if (!isPlainObject(payload.defaultPresentationPolicy)) pushError(errors, "defaultPresentationPolicy", "REQUIRED", "La policy di default e obbligatoria per una visita ufficiale");
    else {
      if (!payload.defaultPresentationPolicy.durationKey) pushError(errors, "defaultPresentationPolicy.durationKey", "REQUIRED", "durationKey e obbligatoria");
      if (!payload.defaultPresentationPolicy.languageLevelKey) pushError(errors, "defaultPresentationPolicy.languageLevelKey", "REQUIRED", "languageLevelKey e obbligatoria");
    }
  }
  if (effectiveKind === "community" && payload.defaultPresentationPolicy != null) pushError(errors, "defaultPresentationPolicy", "FORBIDDEN_FIELD", "Le visite community usano preferenze astratte e default locali");
  if (payload.stops !== undefined) pushError(errors, "stops", "REMOVED_FIELD", "Usare contentEntries");
  if (!Array.isArray(payload.contentEntries)) pushError(errors, "contentEntries", "INVALID_TYPE", "contentEntries deve essere un array");
  else payload.contentEntries.forEach((entry, index) => {
    const field = `contentEntries[${index}]`;
    if (!isPlainObject(entry)) return pushError(errors, field, "INVALID_TYPE", "Ogni content entry deve essere un oggetto");
    if (!mongoose.isValidObjectId(entry.itemId)) pushError(errors, `${field}.itemId`, "INVALID_OBJECT_ID", "itemId deve essere un ObjectId valido");
    if (!CONTENT_ENTRY_ROLES.includes(entry.role || "recommended")) pushError(errors, `${field}.role`, "INVALID_ENUM", "role deve essere core, recommended oppure optional", { allowedValues: CONTENT_ENTRY_ROLES });
    if (!SPATIAL_MODES.includes(entry.spatialMode)) pushError(errors, `${field}.spatialMode`, "INVALID_ENUM", "spatialMode deve essere target oppure context", { allowedValues: SPATIAL_MODES });
  });
  if (payload.logistics != null) {
    if (!isPlainObject(payload.logistics)) pushError(errors, "logistics", "INVALID_TYPE", "logistics deve essere un oggetto");
    else {
      if (payload.logistics.transitions !== undefined) pushError(errors, "logistics.transitions", "REMOVED_FIELD", "Usare logistics.routeHints con ID stabili delle content entry target");
      if (payload.logistics.routeHints !== undefined && !Array.isArray(payload.logistics.routeHints)) pushError(errors, "logistics.routeHints", "INVALID_TYPE", "routeHints deve essere un array");
      (payload.logistics.routeHints || []).forEach((hint, index) => {
        const field = `logistics.routeHints[${index}]`;
        if (!isPlainObject(hint)) return pushError(errors, field, "INVALID_TYPE", "routeHint deve essere un oggetto");
        if (!mongoose.isValidObjectId(hint.fromTargetEntryId)) pushError(errors, `${field}.fromTargetEntryId`, "INVALID_OBJECT_ID", "fromTargetEntryId non valido");
        if (!mongoose.isValidObjectId(hint.toTargetEntryId)) pushError(errors, `${field}.toTargetEntryId`, "INVALID_OBJECT_ID", "toTargetEntryId non valido");
        if (String(hint.fromTargetEntryId) === String(hint.toTargetEntryId)) pushError(errors, field, "SAME_ROUTE_HINT_ENDPOINT", "Un routeHint deve collegare due target diversi");
        if (!["indoor", "inter_venue"].includes(hint.type)) pushError(errors, `${field}.type`, "INVALID_ENUM", "type deve essere indoor oppure inter_venue");
      });
    }
  }
  return errors;
}

module.exports = { CONTENT_ENTRY_ROLES, SPATIAL_MODES, normalizeVisitPayload, validateVisitDraftPayload };
