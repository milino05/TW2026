function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeOrganizationPayload(payload = {}) {
  return {
    ...(hasOwn(payload, "name") ? { name: typeof payload.name === "string" ? payload.name.trim() : payload.name } : {}),
    ...(hasOwn(payload, "description") ? { description: typeof payload.description === "string" ? payload.description.trim() : payload.description } : {}),
  };
}

function validateOrganizationPayload({ payload, mode = "create" }) {
  const issues = [];
  const add = (field, code, message) => issues.push({ field, code, message });
  if (mode === "create" && !payload.name) add("name", "REQUIRED", "name e obbligatorio");
  if (hasOwn(payload, "name") && (typeof payload.name !== "string" || !payload.name.trim())) {
    add("name", "INVALID_STRING", "name deve essere una stringa non vuota");
  }
  if (hasOwn(payload, "description") && typeof payload.description !== "string") {
    add("description", "INVALID_STRING", "description deve essere una stringa");
  }
  const unknown = Object.keys(payload || {}).filter((key) => !["name", "description"].includes(key));
  for (const field of unknown) add(field, "UNKNOWN_FIELD", `Campo non supportato: ${field}`);
  return issues;
}

module.exports = { normalizeOrganizationPayload, validateOrganizationPayload };
