const { buildPositionMap, buildDurationSecondsMap } = require("./vocabularyNormalization.service");
const { listRepresentationCandidates, getDefaultCandidate } = require("./presentationModel.service");

function assertPreferenceValue(value, field) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${field} deve essere un numero compreso tra 0 e 1`); }
function decorate(candidate) { return candidate ? { ...candidate.representation, variantKey: candidate.variantKey, variantLabel: candidate.variantLabel, semanticFocus: candidate.semanticFocus, presentationAspects: candidate.presentationAspects } : null; }
function findDefaultRepresentation(source = []) { return decorate(getDefaultCandidate(source)); }
function findRepresentationByPolicy(source = [], policy = {}, options = {}) {
  const candidates = listRepresentationCandidates(source);
  const preferredVariant = options.variantKey || policy.variantKey || null;
  const candidate = candidates.find((entry) => (!preferredVariant || entry.variantKey === preferredVariant) && entry.representation.durationKey === policy.durationKey && entry.representation.languageLevelKey === policy.languageLevelKey)
    || candidates.find((entry) => entry.representation.durationKey === policy.durationKey && entry.representation.languageLevelKey === policy.languageLevelKey)
    || null;
  return decorate(candidate);
}
function resolveOfficialRepresentation({ source = null, representations = null, defaultPolicy, preference = null, variantKey = null }) {
  const input = source || representations || [];
  const effectivePolicy = preference?.mode === "custom" ? { durationKey: preference.durationKey, languageLevelKey: preference.languageLevelKey, variantKey: preference.variantKey } : defaultPolicy;
  return findRepresentationByPolicy(input, effectivePolicy || {}, { variantKey }) || findDefaultRepresentation(input);
}
function resolveCommunityRepresentation({ source = null, representations = null, durationTypes = [], languageLevels = [], preference, variantScores = new Map() }) {
  const input = source || representations || [];
  const candidates = listRepresentationCandidates(input);
  const fallback = getDefaultCandidate(input) || candidates[0];
  if (!candidates.length) return null;
  if (!preference) return decorate(fallback);
  assertPreferenceValue(preference.depthPreference, "depthPreference"); assertPreferenceValue(preference.languageComplexityPreference, "languageComplexityPreference");
  const durationPositions = buildPositionMap(durationTypes); const languagePositions = buildPositionMap(languageLevels);
  const scored = candidates.map((candidate, sourceIndex) => {
    const depth = durationPositions.get(candidate.representation.durationKey); const language = languagePositions.get(candidate.representation.languageLevelKey);
    if (!Number.isFinite(depth) || !Number.isFinite(language)) return null;
    const depthDistance = Math.abs(depth - preference.depthPreference); const languageDistance = Math.abs(language - preference.languageComplexityPreference);
    const variantBonus = Number(variantScores.get(candidate.variantKey)) || 0;
    return { candidate, sourceIndex, depth, language, depthDistance, totalDistance: depthDistance + languageDistance - variantBonus * 0.25 };
  }).filter(Boolean);
  if (!scored.length) return decorate(fallback);
  scored.sort((a, b) => a.totalDistance - b.totalDistance || a.language - b.language || a.depthDistance - b.depthDistance || a.sourceIndex - b.sourceIndex);
  return decorate(scored[0].candidate);
}
function findAdjacentRepresentation({ source = null, representations = null, durationTypes = [], languageLevels = [], currentRepresentation, axis, direction }) {
  const input = source || representations || []; if (!currentRepresentation || !["duration", "language"].includes(axis) || !["up", "down"].includes(direction)) return null;
  const vocabulary = axis === "duration" ? durationTypes : languageLevels; const keyField = axis === "duration" ? "durationKey" : "languageLevelKey"; const fixedField = axis === "duration" ? "languageLevelKey" : "durationKey";
  const currentIndex = vocabulary.findIndex((entry) => entry.key === currentRepresentation[keyField]); if (currentIndex < 0) return null;
  const candidates = listRepresentationCandidates(input).filter((candidate) => !currentRepresentation.variantKey || candidate.variantKey === currentRepresentation.variantKey);
  const step = direction === "up" ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < vocabulary.length; index += step) {
    const candidate = candidates.find((entry) => entry.representation[keyField] === vocabulary[index].key && entry.representation[fixedField] === currentRepresentation[fixedField]);
    if (candidate) return decorate(candidate);
  }
  return null;
}
function estimateContentSeconds({ selections = [], vocabularyByMuseumId = new Map() }) {
  return selections.reduce((total, selection) => { const vocabulary = vocabularyByMuseumId.get(String(selection.museumId)); if (!vocabulary) return total; const seconds = buildDurationSecondsMap(vocabulary.durationTypes).get(selection.representation?.durationKey); return total + (Number.isFinite(seconds) ? seconds : 0); }, 0);
}

module.exports = { assertPreferenceValue, findDefaultRepresentation, findRepresentationByPolicy, resolveOfficialRepresentation, resolveCommunityRepresentation, findAdjacentRepresentation, estimateContentSeconds };
