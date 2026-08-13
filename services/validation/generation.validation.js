const mongoose = require("mongoose");

const INTEREST_KINDS = ["item", "item_type", "relation_type", "canonical", "presentation_aspect", "tag"];
function issue(field, code, message) { return { field, code, message }; }
function validateUnit(value, field, errors) { if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) errors.push(issue(field, "INVALID_NUMBER", `${field} deve essere tra 0 e 1`)); }
function validateGenerationRequest(payload = {}) {
  const errors = []; const time = Number(payload.timeBudgetSeconds); if (!Number.isFinite(time) || time <= 0) errors.push(issue("timeBudgetSeconds", "INVALID_NUMBER", "timeBudgetSeconds deve essere positivo"));
  for (const field of ["movementPacePreference", "depthPreference", "languageComplexityPreference", "observationEmphasis", "visitDensity", "discoveryPreference", "timeRiskTolerance"]) validateUnit(payload[field], field, errors);
  if (payload.interests !== undefined && !Array.isArray(payload.interests)) errors.push(issue("interests", "INVALID_TYPE", "interests deve essere un array"));
  for (let index = 0; index < (payload.interests || []).length; index += 1) {
    const interest = payload.interests[index]; const field = `interests[${index}]`; if (!interest || typeof interest !== "object" || !INTEREST_KINDS.includes(interest.kind)) { errors.push(issue(field, "INVALID_INTEREST", "Interest non valido")); continue; }
    if (interest.kind === "item" && !mongoose.isValidObjectId(interest.itemId)) errors.push(issue(`${field}.itemId`, "INVALID_OBJECT_ID", "itemId non valido"));
    if (["item_type", "relation_type", "presentation_aspect", "tag"].includes(interest.kind) && !interest.key) errors.push(issue(`${field}.key`, "REQUIRED", "key e obbligatoria"));
    if (interest.kind === "canonical" && (!interest.scheme || !(interest.id || interest.refId))) errors.push(issue(field, "SEMANTIC_REF_REQUIRED", "Interest canonical richiede scheme e id"));
    if (interest.weight !== undefined && (!Number.isFinite(Number(interest.weight)) || Number(interest.weight) < 0)) errors.push(issue(`${field}.weight`, "INVALID_NUMBER", "weight deve essere non negativo"));
  }
  for (const field of ["mustSeeItemIds", "excludedItemIds"]) if (payload[field] !== undefined && (!Array.isArray(payload[field]) || payload[field].some((value) => !mongoose.isValidObjectId(value)))) errors.push(issue(field, "INVALID_OBJECT_ID_ARRAY", `${field} deve contenere ObjectId validi`));
  return errors;
}
module.exports = { INTEREST_KINDS, validateGenerationRequest };
