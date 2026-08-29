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
  if (hasOwn(payload, "displayLabelOverride")) out.displayLabelOverride = trimIfString(payload.displayLabelOverride) || null;
  if (hasOwn(payload, "inventoryNote")) out.inventoryNote = trimIfString(payload.inventoryNote) || null;
  if (hasOwn(payload, "provenance")) out.provenance = payload.provenance;
  return out;
}

function validateVenueTargetPayload({ payload = {}, rawPayload = {}, creating = false } = {}) {
  const issues = [];
  const allowed = ["subjectId", "displayLabelOverride", "inventoryNote", "provenance"];
  for (const key of Object.keys(rawPayload || {})) if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  if (creating && !mongoose.isValidObjectId(payload.subjectId)) issues.push({ field: "subjectId", code: "INVALID_OBJECT_ID", message: "subjectId non valido" });
  if (!creating && hasOwn(rawPayload, "subjectId")) issues.push({ field: "subjectId", code: "IMMUTABLE_FIELD", message: "subjectId non e modificabile" });
  if (hasOwn(payload, "displayLabelOverride") && payload.displayLabelOverride !== null && typeof payload.displayLabelOverride !== "string") issues.push({ field: "displayLabelOverride", code: "INVALID_TYPE", message: "displayLabelOverride deve essere una stringa o null" });
  if (hasOwn(payload, "inventoryNote") && payload.inventoryNote !== null && typeof payload.inventoryNote !== "string") issues.push({ field: "inventoryNote", code: "INVALID_TYPE", message: "inventoryNote deve essere una stringa o null" });
  if (hasOwn(payload, "provenance") && (!payload.provenance || typeof payload.provenance !== "object" || Array.isArray(payload.provenance))) issues.push({ field: "provenance", code: "INVALID_TYPE", message: "provenance deve essere un oggetto" });
  return issues;
}

module.exports = { normalizeVenuePayload, validateVenuePayload, normalizeVenueTargetPayload, validateVenueTargetPayload };
