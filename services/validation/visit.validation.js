const mongoose = require("mongoose");
const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeBoolean,
  normalizeKey,
} = require("./validation.utils");

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
            ? {
                itemId: stop.itemId,
                optional: normalizeBoolean(stop.optional) === true,
              }
            : stop,
        )
      : payload.stops;
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
      if (!isPlainObject(stop)) {
        pushError(errors, `stops[${index}]`, "INVALID_TYPE", "Ogni tappa deve essere un oggetto");
      } else if (!mongoose.isValidObjectId(stop.itemId)) {
        pushError(errors, `stops[${index}].itemId`, "INVALID_OBJECT_ID", "itemId deve essere un ObjectId valido");
      }
    });
  }
  return errors;
}

module.exports = { normalizeVisitPayload, validateVisitDraftPayload };
