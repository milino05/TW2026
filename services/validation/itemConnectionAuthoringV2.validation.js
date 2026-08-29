const mongoose = require("mongoose");
const { isPlainObject } = require("./validation.utils");

const ORIGINS = Object.freeze(["human", "ai_assisted", "ai_generated", "imported", "forked"]);
const ALLOWED_FIELDS = new Set([
  "scopeKey",
  "relationTypeDefinitionId",
  "targetItemId",
  "sourceSubjectClassDefinitionId",
  "targetSubjectClassDefinitionId",
  "weight",
  "provenanceOrigin",
  "note",
]);

function optionalTrimmedString(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim() || null : value;
}

function normalizeItemConnectionPayload(payload = {}) {
  return {
    scopeKey: typeof payload.scopeKey === "string" ? payload.scopeKey.trim() : payload.scopeKey,
    relationTypeDefinitionId: typeof payload.relationTypeDefinitionId === "string" ? payload.relationTypeDefinitionId.trim() : payload.relationTypeDefinitionId,
    targetItemId: payload.targetItemId,
    sourceSubjectClassDefinitionId: optionalTrimmedString(payload.sourceSubjectClassDefinitionId),
    targetSubjectClassDefinitionId: optionalTrimmedString(payload.targetSubjectClassDefinitionId),
    weight: payload.weight === undefined || payload.weight === "" ? 5 : Number(payload.weight),
    provenanceOrigin: typeof payload.provenanceOrigin === "string" ? payload.provenanceOrigin.trim() : (payload.provenanceOrigin ?? "human"),
    note: typeof payload.note === "string" ? payload.note.trim() : (payload.note ?? ""),
  };
}

function validateItemConnectionPayload(payload = {}) {
  const issues = [];
  if (!isPlainObject(payload)) return [{ field: "payload", code: "INVALID_TYPE", message: "Il payload deve essere un oggetto" }];
  for (const field of Object.keys(payload)) {
    if (!ALLOWED_FIELDS.has(field)) issues.push({ field, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${field}` });
  }
  if (typeof payload.scopeKey !== "string" || !payload.scopeKey.trim()) issues.push({ field: "scopeKey", code: "REQUIRED", message: "Scegli l’ambito editoriale" });
  if (typeof payload.relationTypeDefinitionId !== "string" || !payload.relationTypeDefinitionId.trim()) issues.push({ field: "relationTypeDefinitionId", code: "REQUIRED", message: "Scegli il tipo di collegamento" });
  if (!mongoose.isValidObjectId(payload.targetItemId)) issues.push({ field: "targetItemId", code: "INVALID_OBJECT_ID", message: "Il contenuto collegato non è valido" });
  for (const field of ["sourceSubjectClassDefinitionId", "targetSubjectClassDefinitionId"]) {
    const value = payload[field];
    if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim())) {
      issues.push({ field, code: "INVALID_VALUE", message: "Il tipo semantico deve essere una stringa non vuota" });
    }
  }
  if (payload.weight !== undefined && payload.weight !== "" && (!Number.isFinite(Number(payload.weight)) || Number(payload.weight) < 0 || Number(payload.weight) > 10)) {
    issues.push({ field: "weight", code: "OUT_OF_RANGE", message: "L’importanza deve essere compresa fra 0 e 10" });
  }
  if (payload.provenanceOrigin !== undefined && !ORIGINS.includes(String(payload.provenanceOrigin).trim())) {
    issues.push({ field: "provenanceOrigin", code: "INVALID_ENUM", message: "La provenienza non è valida", allowedValues: ORIGINS });
  }
  if (payload.note !== undefined && typeof payload.note !== "string") issues.push({ field: "note", code: "INVALID_TYPE", message: "La nota deve essere una stringa" });
  else if (String(payload.note || "").trim().length > 1000) issues.push({ field: "note", code: "TOO_LONG", message: "La nota può contenere al massimo 1000 caratteri" });
  return issues;
}

module.exports = { ORIGINS, normalizeItemConnectionPayload, validateItemConnectionPayload };
