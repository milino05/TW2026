const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function unitPosition(values, definitionId) {
  const index = (values || []).findIndex((entry) => String(entry.definitionId) === String(definitionId));
  if (index < 0) return null;
  return values.length <= 1 ? 0.5 : index / (values.length - 1);
}
function durationSeconds(namespaceRevision, definitionId) {
  const definition = (namespaceRevision?.durationTypes || []).find((entry) => String(entry.definitionId) === String(definitionId));
  return Number(definition?.targetSeconds) || 0;
}
function allCandidates(revision) {
  const result = [];
  for (const variant of revision?.presentationVariants || []) for (const representation of variant.representations || []) result.push({ variant, representation });
  return result;
}
function candidateByIds(revision, variantId, representationId) {
  return allCandidates(revision).find((entry) => id(entry.variant._id) === id(variantId) && id(entry.representation._id) === id(representationId)) || null;
}
function defaultCandidate(revision) {
  const ref = revision?.defaultPresentation;
  return ref ? candidateByIds(revision, ref.variantId, ref.representationId) : null;
}
function presentationValue(candidate, namespaceRevision) {
  if (!candidate) return null;
  return {
    variantId: candidate.variant._id,
    representationId: candidate.representation._id,
    durationTypeDefinitionId: candidate.representation.durationTypeDefinitionId,
    languageLevelDefinitionId: candidate.representation.languageLevelDefinitionId,
    locale: candidate.representation.locale,
    text: candidate.representation.text,
    estimatedContentSeconds: durationSeconds(namespaceRevision, candidate.representation.durationTypeDefinitionId),
  };
}
function effectivePreference({ visitBaseline = null, userPreference = null, explicitPreference = null } = {}) {
  const merged = {};
  for (const layer of [visitBaseline, userPreference, explicitPreference]) {
    if (!layer) continue;
    for (const field of ["depthPreference", "languageComplexityPreference", "locale"]) if (layer[field] !== undefined && layer[field] !== null) merged[field] = layer[field];
  }
  return merged;
}
function validateUnit(value, field) {
  if (value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_NUMBER" }]);
}
function resolveInitialPresentation({ revision, namespaceRevision, generatedBaseline = null, visitBaseline = null, userPreference = null, explicitPreference = null }) {
  const fallback = generatedBaseline
    ? candidateByIds(revision, generatedBaseline.variantId, generatedBaseline.representationId)
    : defaultCandidate(revision);
  if (!fallback) throw new AppError("ItemRevision senza defaultPresentation risolvibile", 409);
  const preference = effectivePreference({ visitBaseline, userPreference, explicitPreference });
  validateUnit(preference.depthPreference, "presentationPreference.depthPreference");
  validateUnit(preference.languageComplexityPreference, "presentationPreference.languageComplexityPreference");
  const preferredVariantId = fallback.variant._id;
  const candidates = allCandidates(revision).filter((entry) => id(entry.variant._id) === id(preferredVariantId));
  if (!candidates.length) return presentationValue(fallback, namespaceRevision);
  const locale = preference.locale || fallback.representation.locale;
  const localeCandidates = candidates.filter((entry) => String(entry.representation.locale).toLowerCase() === String(locale).toLowerCase());
  const pool = localeCandidates.length ? localeCandidates : candidates;
  if (preference.depthPreference === undefined && preference.languageComplexityPreference === undefined && pool.includes(fallback)) return presentationValue(fallback, namespaceRevision);
  const targetDepth = preference.depthPreference === undefined ? unitPosition(namespaceRevision.durationTypes, fallback.representation.durationTypeDefinitionId) : Number(preference.depthPreference);
  const targetLanguage = preference.languageComplexityPreference === undefined ? unitPosition(namespaceRevision.languageLevels, fallback.representation.languageLevelDefinitionId) : Number(preference.languageComplexityPreference);
  const scored = pool.map((candidate, index) => {
    const depth = unitPosition(namespaceRevision.durationTypes, candidate.representation.durationTypeDefinitionId);
    const language = unitPosition(namespaceRevision.languageLevels, candidate.representation.languageLevelDefinitionId);
    if (depth === null || language === null) return null;
    return { candidate, index, score: Math.abs(depth - targetDepth) + Math.abs(language - targetLanguage) };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.index - b.index);
  return presentationValue(scored[0]?.candidate || fallback, namespaceRevision);
}
function findAdjacentPresentation({ revision, namespaceRevision, current, axis, direction }) {
  if (!current || !["duration", "language"].includes(axis) || !["up", "down"].includes(direction)) return null;
  const definitions = axis === "duration" ? namespaceRevision.durationTypes || [] : namespaceRevision.languageLevels || [];
  const field = axis === "duration" ? "durationTypeDefinitionId" : "languageLevelDefinitionId";
  const fixedField = axis === "duration" ? "languageLevelDefinitionId" : "durationTypeDefinitionId";
  const currentIndex = definitions.findIndex((entry) => String(entry.definitionId) === String(current[field]));
  if (currentIndex < 0) return null;
  const variant = (revision.presentationVariants || []).find((entry) => id(entry._id) === id(current.variantId));
  if (!variant) return null;
  const step = direction === "up" ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < definitions.length; index += step) {
    const definitionId = definitions[index].definitionId;
    const representation = (variant.representations || []).find((entry) =>
      String(entry[field]) === String(definitionId)
      && String(entry[fixedField]) === String(current[fixedField])
      && String(entry.locale).toLowerCase() === String(current.locale).toLowerCase());
    if (representation) return presentationValue({ variant, representation }, namespaceRevision);
  }
  return null;
}
function resolvePresentationText({ revision, selection }) {
  const candidate = candidateByIds(revision, selection?.variantId, selection?.representationId);
  if (!candidate) throw new AppError("Representation della Session non risolvibile", 409);
  return candidate.representation.text;
}

module.exports = { id, unitPosition, durationSeconds, effectivePreference, resolveInitialPresentation, findAdjacentPresentation, resolvePresentationText };
