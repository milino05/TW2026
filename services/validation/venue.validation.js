const mongoose = require("mongoose");
const { hasOwn, trimIfString } = require("./validation.utils");

function normalizeVenuePayload(payload = {}) {
  const out = {};
  if (hasOwn(payload, "name")) out.name = trimIfString(payload.name);
  if (hasOwn(payload, "description")) out.description = trimIfString(payload.description);
  if (hasOwn(payload, "ownerOrganizationId")) out.ownerOrganizationId = payload.ownerOrganizationId;
  if (hasOwn(payload, "primaryEditorialContextId")) out.primaryEditorialContextId = payload.primaryEditorialContextId || null;
  return out;
}

function validateVenuePayload({ payload = {}, rawPayload = {}, creating = false } = {}) {
  const issues = [];
  const allowed = ["name", "description", "ownerOrganizationId", "primaryEditorialContextId"];
  for (const key of Object.keys(rawPayload || {})) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (creating && (!payload.name || typeof payload.name !== "string")) issues.push({ field: "name", code: "REQUIRED", message: "name e obbligatorio" });
  if (hasOwn(payload, "name") && (!payload.name || typeof payload.name !== "string")) issues.push({ field: "name", code: "INVALID_VALUE", message: "name deve essere una stringa non vuota" });
  if (creating && !mongoose.isValidObjectId(payload.ownerOrganizationId)) issues.push({ field: "ownerOrganizationId", code: "INVALID_OBJECT_ID", message: "ownerOrganizationId non valido" });
  if (!creating && hasOwn(rawPayload, "ownerOrganizationId")) issues.push({ field: "ownerOrganizationId", code: "IMMUTABLE_FIELD", message: "ownerOrganizationId non e modificabile" });
  if (payload.primaryEditorialContextId && !mongoose.isValidObjectId(payload.primaryEditorialContextId)) issues.push({ field: "primaryEditorialContextId", code: "INVALID_OBJECT_ID", message: "primaryEditorialContextId non valido" });
  return issues;
}

function normalizeVenueTargetPayload(payload = {}) {
  const out = {};
  if (hasOwn(payload, "subjectId")) out.subjectId = payload.subjectId;
  if (hasOwn(payload, "label")) out.label = trimIfString(payload.label);
  if (hasOwn(payload, "description")) out.description = trimIfString(payload.description);
  return out;
}

function validateVenueTargetPayload({ payload = {}, rawPayload = {}, creating = false } = {}) {
  const issues = [];
  const allowed = ["subjectId", "label", "description"];
  for (const key of Object.keys(rawPayload || {})) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (creating && !mongoose.isValidObjectId(payload.subjectId)) issues.push({ field: "subjectId", code: "INVALID_OBJECT_ID", message: "subjectId non valido" });
  if (!creating && hasOwn(rawPayload, "subjectId")) issues.push({ field: "subjectId", code: "IMMUTABLE_FIELD", message: "subjectId non e modificabile" });
  if ((creating || hasOwn(payload, "label")) && (!payload.label || typeof payload.label !== "string")) issues.push({ field: "label", code: "REQUIRED", message: "label e obbligatoria" });
  return issues;
}

module.exports = { normalizeVenuePayload, validateVenuePayload, normalizeVenueTargetPayload, validateVenueTargetPayload };
