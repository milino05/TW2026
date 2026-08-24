function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeSubjectPayload(payload = {}) {
  return {
    ...(hasOwn(payload, "preferredLabel") ? { preferredLabel: typeof payload.preferredLabel === "string" ? payload.preferredLabel.trim() : payload.preferredLabel } : {}),
    ...(hasOwn(payload, "description") ? { description: typeof payload.description === "string" ? payload.description.trim() : payload.description } : {}),
  };
}

function validateSubjectPayload({ payload, rawPayload = payload, mode = "create" }) {
  const issues = [];
  const add = (field, code, message) => issues.push({ field, code, message });
  if (mode === "create" && !payload.preferredLabel) add("preferredLabel", "REQUIRED", "preferredLabel e obbligatorio");
  if (hasOwn(payload, "preferredLabel") && (typeof payload.preferredLabel !== "string" || !payload.preferredLabel.trim())) {
    add("preferredLabel", "INVALID_STRING", "preferredLabel deve essere una stringa non vuota");
  }
  if (hasOwn(payload, "description") && typeof payload.description !== "string") {
    add("description", "INVALID_STRING", "description deve essere una stringa");
  }
  const unknown = Object.keys(rawPayload || {}).filter((key) => !["preferredLabel", "description"].includes(key));
  for (const field of unknown) add(field, "UNKNOWN_FIELD", `Campo non supportato: ${field}`);
  return issues;
}

module.exports = { normalizeSubjectPayload, validateSubjectPayload };
