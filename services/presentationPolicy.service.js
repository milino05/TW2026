const {
  buildPositionMap,
  buildDurationSecondsMap,
} = require("./vocabularyNormalization.service");

function assertPreferenceValue(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} deve essere un numero compreso tra 0 e 1`);
  }
}

function findDefaultRepresentation(representations = []) {
  return representations.find((representation) => representation.isDefault === true) || null;
}

function findRepresentationByPolicy(representations = [], policy = {}) {
  return (
    representations.find(
      (representation) =>
        representation.durationKey === policy.durationKey &&
        representation.languageLevelKey === policy.languageLevelKey,
    ) || null
  );
}

function resolveOfficialRepresentation({ representations = [], defaultPolicy, preference = null }) {
  const effectivePolicy =
    preference?.mode === "custom"
      ? {
          durationKey: preference.durationKey,
          languageLevelKey: preference.languageLevelKey,
        }
      : defaultPolicy;

  return findRepresentationByPolicy(representations, effectivePolicy) || findDefaultRepresentation(representations);
}

function resolveCommunityRepresentation({
  representations = [],
  durationTypes = [],
  languageLevels = [],
  preference,
}) {
  if (!Array.isArray(representations) || representations.length === 0) return null;

  const fallback = findDefaultRepresentation(representations) || representations[0];
  if (!preference) return fallback;

  assertPreferenceValue(preference.depthPreference, "depthPreference");
  assertPreferenceValue(
    preference.languageComplexityPreference,
    "languageComplexityPreference",
  );

  const durationPositions = buildPositionMap(durationTypes);
  const languagePositions = buildPositionMap(languageLevels);

  const candidates = representations
    .map((representation, sourceIndex) => {
      const depth = durationPositions.get(representation.durationKey);
      const language = languagePositions.get(representation.languageLevelKey);
      if (!Number.isFinite(depth) || !Number.isFinite(language)) return null;

      const depthDistance = Math.abs(depth - preference.depthPreference);
      const languageDistance = Math.abs(
        language - preference.languageComplexityPreference,
      );

      return {
        representation,
        sourceIndex,
        depth,
        language,
        depthDistance,
        languageDistance,
        totalDistance: depthDistance + languageDistance,
      };
    })
    .filter(Boolean);

  if (candidates.length === 0) return fallback;

  candidates.sort((a, b) => {
    if (a.totalDistance !== b.totalDistance) return a.totalDistance - b.totalDistance;
    if (a.language !== b.language) return a.language - b.language;
    if (a.depthDistance !== b.depthDistance) return a.depthDistance - b.depthDistance;
    if (Boolean(a.representation.isDefault) !== Boolean(b.representation.isDefault)) {
      return a.representation.isDefault ? -1 : 1;
    }
    return a.sourceIndex - b.sourceIndex;
  });

  return candidates[0].representation;
}

function findAdjacentRepresentation({
  representations = [],
  durationTypes = [],
  languageLevels = [],
  currentRepresentation,
  axis,
  direction,
}) {
  if (!currentRepresentation || !["duration", "language"].includes(axis)) return null;
  if (!["up", "down"].includes(direction)) return null;

  const vocabulary = axis === "duration" ? durationTypes : languageLevels;
  const keyField = axis === "duration" ? "durationKey" : "languageLevelKey";
  const fixedField = axis === "duration" ? "languageLevelKey" : "durationKey";
  const currentIndex = vocabulary.findIndex(
    (entry) => entry.key === currentRepresentation[keyField],
  );
  if (currentIndex < 0) return null;

  const step = direction === "up" ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < vocabulary.length; index += step) {
    const candidate = representations.find(
      (representation) =>
        representation[keyField] === vocabulary[index].key &&
        representation[fixedField] === currentRepresentation[fixedField],
    );
    if (candidate) return candidate;
  }
  return null;
}

function estimateContentSeconds({ selections = [], vocabularyByMuseumId = new Map() }) {
  return selections.reduce((total, selection) => {
    const vocabulary = vocabularyByMuseumId.get(String(selection.museumId));
    if (!vocabulary) return total;
    const seconds = buildDurationSecondsMap(vocabulary.durationTypes).get(
      selection.representation?.durationKey,
    );
    return total + (Number.isFinite(seconds) ? seconds : 0);
  }, 0);
}

module.exports = {
  assertPreferenceValue,
  findDefaultRepresentation,
  findRepresentationByPolicy,
  resolveOfficialRepresentation,
  resolveCommunityRepresentation,
  findAdjacentRepresentation,
  estimateContentSeconds,
};
