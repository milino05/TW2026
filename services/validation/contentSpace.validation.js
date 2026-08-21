const mongoose = require("mongoose");
const { OWNER_TYPES } = require("../resourceOwnership.service");
const { hasOwn, trimIfString } = require("./validation.utils");

function normalizeContentSpacePayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  if (hasOwn(payload, "description")) normalized.description = payload.description === null ? null : trimIfString(payload.description);
  if (hasOwn(payload, "ownerType")) normalized.ownerType = trimIfString(payload.ownerType);
  if (hasOwn(payload, "ownerId")) normalized.ownerId = payload.ownerId;
  return normalized;
}

function validateContentSpacePayload({ payload = {}, rawPayload = payload, creating = false }) {
  const issues = [];
  const allowed = creating ? ["name", "description", "ownerType", "ownerId"] : ["name", "description"];
  for (const field of Object.keys(rawPayload || {})) {
    if (!allowed.includes(field)) issues.push({ field, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${field}` });
  }
  if (creating || hasOwn(payload, "name")) {
    if (typeof payload.name !== "string" || !payload.name.trim()) issues.push({ field: "name", code: "REQUIRED", message: "name e obbligatorio" });
  }
  if (hasOwn(payload, "description") && payload.description !== null && typeof payload.description !== "string") {
    issues.push({ field: "description", code: "INVALID_STRING", message: "description deve essere una stringa o null" });
  }
  if (creating) {
    if (!OWNER_TYPES.includes(payload.ownerType)) issues.push({ field: "ownerType", code: "INVALID_ENUM", message: "ownerType non valido", allowedValues: OWNER_TYPES });
    if (!mongoose.isValidObjectId(payload.ownerId)) issues.push({ field: "ownerId", code: "INVALID_OBJECT_ID", message: "ownerId non valido" });
  }
  return issues;
}

module.exports = { normalizeContentSpacePayload, validateContentSpacePayload };
