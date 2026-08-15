const { pushError, hasOwn, trimIfString } = require("./validation.utils");

function normalizeMuseumPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  return normalized;
}

function validateMuseumPayload({ payload, rawPayload = payload }) {
  const errors = [];
  if (!payload.name || typeof payload.name !== "string") {
    pushError(errors, "name", "REQUIRED", "Il campo name e obbligatorio");
  }
  for (const field of ["config", "vocabularyRevision", "vocabulary"]) {
    if (hasOwn(rawPayload || {}, field)) {
      pushError(
        errors,
        field,
        "REMOVED_FIELD",
        `${field} non appartiene a Museum: usare le API del vocabolario semantico revisionato`,
      );
    }
  }
  return errors;
}

module.exports = { normalizeMuseumPayload, validateMuseumPayload };
