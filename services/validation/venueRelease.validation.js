const mongoose = require("mongoose");
const { hasOwn, isPlainObject, trimIfString } = require("./validation.utils");

const LAYOUT_FIELDS = ["floors", "places", "venueTargetPlacements", "connections"];

function normalizeRecognitionMedia(values) {
  if (!Array.isArray(values)) return values;
  return values.map((entry) => isPlainObject(entry) ? { ...entry, url: trimIfString(entry.url), altText: trimIfString(entry.altText) } : entry);
}

function normalizeTargetBindings(values) {
  if (!Array.isArray(values)) return values;
  return values.map((entry) => isPlainObject(entry) ? {
    venueTargetId: entry.venueTargetId,
    availability: trimIfString(entry.availability),
    recognitionMedia: normalizeRecognitionMedia(entry.recognitionMedia || []),
  } : entry);
}

function normalizeWorkingVenueReleasePayload(payload = {}) {
  const out = {};
  if (hasOwn(payload, "targetBindings")) out.targetBindings = normalizeTargetBindings(payload.targetBindings);
  if (hasOwn(payload, "preVisitInformation")) out.preVisitInformation = Array.isArray(payload.preVisitInformation) ? payload.preVisitInformation.map(trimIfString) : payload.preVisitInformation;
  if (hasOwn(payload, "layout")) out.layout = payload.layout;
  return out;
}

function validateWorkingVenueReleasePayload({ payload = {}, rawPayload = {} } = {}) {
  const issues = [];
  const allowed = ["targetBindings", "preVisitInformation", "layout"];
  for (const key of Object.keys(rawPayload || {})) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (hasOwn(payload, "targetBindings") && !Array.isArray(payload.targetBindings)) issues.push({ field: "targetBindings", code: "INVALID_TYPE", message: "targetBindings deve essere un array" });
  if (Array.isArray(payload.targetBindings)) payload.targetBindings.forEach((binding, index) => {
    const base = `targetBindings[${index}]`;
    if (!isPlainObject(binding)) { issues.push({ field: base, code: "INVALID_TYPE", message: "Target binding non valido" }); return; }
    if (!mongoose.isValidObjectId(binding.venueTargetId)) issues.push({ field: `${base}.venueTargetId`, code: "INVALID_OBJECT_ID", message: "venueTargetId non valido" });
    if (!['active', 'unavailable'].includes(binding.availability || "active")) issues.push({ field: `${base}.availability`, code: "INVALID_ENUM", message: "availability non valida" });
    if (!Array.isArray(binding.recognitionMedia || [])) issues.push({ field: `${base}.recognitionMedia`, code: "INVALID_TYPE", message: "recognitionMedia deve essere un array" });
    else (binding.recognitionMedia || []).forEach((media, mediaIndex) => {
      if (!isPlainObject(media) || !media.url || typeof media.url !== "string") issues.push({ field: `${base}.recognitionMedia[${mediaIndex}].url`, code: "REQUIRED", message: "url e obbligatorio" });
    });
  });
  if (hasOwn(payload, "preVisitInformation")) {
    if (!Array.isArray(payload.preVisitInformation)) issues.push({ field: "preVisitInformation", code: "INVALID_TYPE", message: "preVisitInformation deve essere un array" });
    else payload.preVisitInformation.forEach((entry, index) => { if (!entry || typeof entry !== "string") issues.push({ field: `preVisitInformation[${index}]`, code: "INVALID_VALUE", message: "Informazione pre-visita non valida" }); });
  }
  if (hasOwn(payload, "layout")) {
    if (!isPlainObject(payload.layout)) issues.push({ field: "layout", code: "INVALID_TYPE", message: "layout deve essere un oggetto" });
    else {
      for (const key of Object.keys(payload.layout)) if (!LAYOUT_FIELDS.includes(key)) issues.push({ field: `layout.${key}`, code: "UNKNOWN_FIELD", message: `Campo layout non supportato: ${key}` });
      for (const key of LAYOUT_FIELDS) if (hasOwn(payload.layout, key) && !Array.isArray(payload.layout[key])) issues.push({ field: `layout.${key}`, code: "INVALID_TYPE", message: `${key} deve essere un array` });
    }
  }
  return issues;
}

module.exports = { LAYOUT_FIELDS, normalizeWorkingVenueReleasePayload, validateWorkingVenueReleasePayload };
