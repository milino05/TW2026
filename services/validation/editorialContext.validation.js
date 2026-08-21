const mongoose = require("mongoose");
const { hasOwn, trimIfString } = require("./validation.utils");

function normalizeEditorialContextPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "contentSpaceId")) normalized.contentSpaceId = payload.contentSpaceId;
  if (hasOwn(payload, "namespaceId")) normalized.namespaceId = payload.namespaceId;
  if (hasOwn(payload, "displayName")) normalized.displayName = trimIfString(payload.displayName);
  if (hasOwn(payload, "shortDescription")) normalized.shortDescription = payload.shortDescription === null ? null : trimIfString(payload.shortDescription);
  if (hasOwn(payload, "description")) normalized.description = payload.description === null ? null : trimIfString(payload.description);
  return normalized;
}

function validateEditorialContextPayload({ payload = {}, rawPayload = payload, creating = false }) {
  const issues = [];
  const allowed = creating
    ? ["contentSpaceId", "namespaceId", "displayName", "shortDescription", "description"]
    : ["displayName", "shortDescription", "description"];
  for (const field of Object.keys(rawPayload || {})) {
    if (!allowed.includes(field)) issues.push({ field, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${field}` });
  }
  if (creating) {
    if (!mongoose.isValidObjectId(payload.contentSpaceId)) issues.push({ field: "contentSpaceId", code: "INVALID_OBJECT_ID", message: "contentSpaceId non valido" });
    if (!mongoose.isValidObjectId(payload.namespaceId)) issues.push({ field: "namespaceId", code: "INVALID_OBJECT_ID", message: "namespaceId non valido" });
  }
  if (creating || hasOwn(payload, "displayName")) {
    if (typeof payload.displayName !== "string" || !payload.displayName.trim()) issues.push({ field: "displayName", code: "REQUIRED", message: "displayName e obbligatorio" });
  }
  for (const field of ["shortDescription", "description"]) {
    if (hasOwn(payload, field) && payload[field] !== null && typeof payload[field] !== "string") {
      issues.push({ field, code: "INVALID_STRING", message: `${field} deve essere una stringa o null` });
    }
  }
  return issues;
}

module.exports = { normalizeEditorialContextPayload, validateEditorialContextPayload };
