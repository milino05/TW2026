function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeExternalRef(ref = {}) {
  return {
    scheme: typeof ref.scheme === "string" ? ref.scheme.trim().toLowerCase() : ref.scheme,
    id: typeof ref.id === "string" ? ref.id.trim() : ref.id,
    matchType: typeof ref.matchType === "string" ? ref.matchType.trim().toLowerCase() : (ref.matchType || "exact"),
  };
}

function normalizeSubjectPayload(payload = {}) {
  return {
    ...(hasOwn(payload, "preferredLabel") ? { preferredLabel: typeof payload.preferredLabel === "string" ? payload.preferredLabel.trim() : payload.preferredLabel } : {}),
    ...(hasOwn(payload, "description") ? { description: typeof payload.description === "string" ? payload.description.trim() : payload.description } : {}),
    ...(hasOwn(payload, "externalRefs") ? { externalRefs: Array.isArray(payload.externalRefs) ? payload.externalRefs.map(normalizeExternalRef) : payload.externalRefs } : {}),
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
  if (hasOwn(payload, "externalRefs")) {
    if (!Array.isArray(payload.externalRefs)) add("externalRefs", "INVALID_ARRAY", "externalRefs deve essere un array");
    else {
      const seen = new Set();
      payload.externalRefs.forEach((ref, index) => {
        const field = `externalRefs[${index}]`;
        if (!ref || typeof ref !== "object") { add(field, "INVALID_OBJECT", "externalRef deve essere un oggetto"); return; }
        if (!ref.scheme || typeof ref.scheme !== "string") add(`${field}.scheme`, "REQUIRED", "scheme e obbligatorio");
        if (!ref.id || typeof ref.id !== "string") add(`${field}.id`, "REQUIRED", "id e obbligatorio");
        if (!["exact", "close", "broader", "narrower"].includes(ref.matchType || "exact")) add(`${field}.matchType`, "INVALID_ENUM", "matchType non valido");
        const key = `${String(ref.scheme || "").toLowerCase()}::${String(ref.id || "")}`;
        if (seen.has(key)) add(field, "DUPLICATE_EXTERNAL_REF", "externalRef duplicato nello stesso Subject");
        seen.add(key);
      });
    }
  }
  const unknown = Object.keys(rawPayload || {}).filter((key) => !["preferredLabel", "description", "externalRefs"].includes(key));
  for (const field of unknown) add(field, "UNKNOWN_FIELD", `Campo non supportato: ${field}`);
  return issues;
}

module.exports = { normalizeSubjectPayload, validateSubjectPayload };
