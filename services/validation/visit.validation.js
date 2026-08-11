const mongoose = require("mongoose");
const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeBoolean,
  normalizeKey,
} = require("./validation.utils");

function normalizeTransition(transition) {
  if (!isPlainObject(transition)) return transition;
  return {
    fromStopIndex: Number(transition.fromStopIndex),
    toStopIndex: Number(transition.toStopIndex),
    type: trimIfString(transition.type),
    layoutRevisionId: transition.layoutRevisionId || null,
    plannedPath: Array.isArray(transition.plannedPath) ? transition.plannedPath : [],
    instructionOverride: trimIfString(transition.instructionOverride),
    communityNote: trimIfString(transition.communityNote),
    estimatedTransferSeconds: transition.estimatedTransferSeconds == null ? null : Number(transition.estimatedTransferSeconds),
  };
}

function normalizeVisitPayload(payload = {}) {
  const normalized = {};
  ["kind", "title", "description"].forEach((field) => {
    if (hasOwn(payload, field)) normalized[field] = trimIfString(payload[field]);
  });
  if (hasOwn(payload, "ownerMuseumId")) normalized.ownerMuseumId = payload.ownerMuseumId;
  if (hasOwn(payload, "defaultPresentationPolicy")) {
    normalized.defaultPresentationPolicy = isPlainObject(payload.defaultPresentationPolicy)
      ? {
          durationKey: normalizeKey(payload.defaultPresentationPolicy.durationKey),
          languageLevelKey: normalizeKey(payload.defaultPresentationPolicy.languageLevelKey),
        }
      : payload.defaultPresentationPolicy;
  }
  if (hasOwn(payload, "stops")) {
    normalized.stops = Array.isArray(payload.stops)
      ? payload.stops.map((stop) =>
          isPlainObject(stop)
            ? { itemId: stop.itemId, optional: normalizeBoolean(stop.optional) === true }
            : stop,
        )
      : payload.stops;
  }
  if (hasOwn(payload, "logistics")) {
    normalized.logistics = isPlainObject(payload.logistics)
      ? {
          preVisitNotes: Array.isArray(payload.logistics.preVisitNotes)
            ? payload.logistics.preVisitNotes.map(trimIfString).filter(Boolean)
            : [],
          transitions: Array.isArray(payload.logistics.transitions)
            ? payload.logistics.transitions.map(normalizeTransition)
            : [],
        }
      : payload.logistics;
  }
  return normalized;
}

function validateVisitDraftPayload({ payload, kind, mode = "create" }) {
  const errors = [];
  const effectiveKind = payload.kind || kind;
  if (mode === "create" && !["official", "community"].includes(effectiveKind)) {
    pushError(errors, "kind", "INVALID_ENUM", "kind deve essere official oppure community");
  }
  if ((mode === "create" || hasOwn(payload, "title")) && (!payload.title || typeof payload.title !== "string")) {
    pushError(errors, "title", "REQUIRED", "title e obbligatorio");
  }
  if (effectiveKind === "official") {
    if (mode === "create" && !mongoose.isValidObjectId(payload.ownerMuseumId)) {
      pushError(errors, "ownerMuseumId", "REQUIRED", "ownerMuseumId e obbligatorio per una visita ufficiale");
    }
    if (!isPlainObject(payload.defaultPresentationPolicy)) {
      pushError(errors, "defaultPresentationPolicy", "REQUIRED", "La policy di default e obbligatoria per una visita ufficiale");
    } else {
      if (!payload.defaultPresentationPolicy.durationKey) pushError(errors, "defaultPresentationPolicy.durationKey", "REQUIRED", "durationKey e obbligatoria");
      if (!payload.defaultPresentationPolicy.languageLevelKey) pushError(errors, "defaultPresentationPolicy.languageLevelKey", "REQUIRED", "languageLevelKey e obbligatoria");
    }
  }
  if (effectiveKind === "community" && payload.defaultPresentationPolicy != null) {
    pushError(errors, "defaultPresentationPolicy", "FORBIDDEN_FIELD", "Le visite community usano preferenze astratte e default locali");
  }
  if (!Array.isArray(payload.stops)) {
    pushError(errors, "stops", "INVALID_TYPE", "stops deve essere un array");
  } else {
    payload.stops.forEach((stop, index) => {
      if (!isPlainObject(stop)) pushError(errors, `stops[${index}]`, "INVALID_TYPE", "Ogni tappa deve essere un oggetto");
      else if (!mongoose.isValidObjectId(stop.itemId)) pushError(errors, `stops[${index}].itemId`, "INVALID_OBJECT_ID", "itemId deve essere un ObjectId valido");
    });
  }
  if (payload.logistics != null) {
    if (!isPlainObject(payload.logistics)) {
      pushError(errors, "logistics", "INVALID_TYPE", "logistics deve essere un oggetto");
    } else if (Array.isArray(payload.logistics.transitions)) {
      payload.logistics.transitions.forEach((transition, index) => {
        if (!isPlainObject(transition)) {
          pushError(errors, `logistics.transitions[${index}]`, "INVALID_TYPE", "La transizione deve essere un oggetto");
          return;
        }
        if (!Number.isInteger(transition.fromStopIndex) || !Number.isInteger(transition.toStopIndex)) {
          pushError(errors, `logistics.transitions[${index}]`, "INVALID_STOP_INDEX", "Gli indici delle tappe devono essere interi");
        }
        if (transition.toStopIndex !== transition.fromStopIndex + 1) {
          pushError(errors, `logistics.transitions[${index}]`, "NON_CONSECUTIVE_TRANSITION", "Una transizione deve collegare due tappe consecutive");
        }
        if (!["indoor", "inter_venue"].includes(transition.type)) {
          pushError(errors, `logistics.transitions[${index}].type`, "INVALID_ENUM", "type deve essere indoor oppure inter_venue");
        }
        if (transition.type === "indoor" && transition.layoutRevisionId && !mongoose.isValidObjectId(transition.layoutRevisionId)) {
          pushError(errors, `logistics.transitions[${index}].layoutRevisionId`, "INVALID_OBJECT_ID", "layoutRevisionId non valido");
        }
        if (transition.type === "inter_venue" && transition.estimatedTransferSeconds != null && (!Number.isFinite(transition.estimatedTransferSeconds) || transition.estimatedTransferSeconds < 0)) {
          pushError(errors, `logistics.transitions[${index}].estimatedTransferSeconds`, "INVALID_NUMBER", "estimatedTransferSeconds deve essere positivo");
        }
      });
    }
  }
  return errors;
}

module.exports = { normalizeVisitPayload, validateVisitDraftPayload };
