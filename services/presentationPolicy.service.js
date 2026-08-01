const AppError = require("../utils/AppError");

function resolvePresentationPolicy({ defaultPresentationPolicy, userPreference }) {
  if (!userPreference || userPreference.mode === "default") {
    return { ...defaultPresentationPolicy };
  }

  if (userPreference.mode !== "custom") {
    throw new AppError("Preferenza di presentazione non valida", 400, [
      {
        field: "mode",
        code: "INVALID_ENUM",
        message: "mode deve essere default oppure custom",
        allowedValues: ["default", "custom"],
      },
    ]);
  }

  if (!userPreference.durationKey || !userPreference.languageLevelKey) {
    throw new AppError("Preferenza di presentazione incompleta", 400, [
      {
        field: "presentationPreference",
        code: "INCOMPLETE_POLICY",
        message: "Una preferenza custom richiede durationKey e languageLevelKey",
      },
    ]);
  }

  return {
    durationKey: userPreference.durationKey,
    languageLevelKey: userPreference.languageLevelKey,
  };
}

function findRepresentationByPolicy({ item, policy }) {
  return (item.representations || []).find(
    (representation) =>
      representation.durationKey === policy.durationKey &&
      representation.languageLevelKey === policy.languageLevelKey,
  ) || null;
}

function getOrderedEntry(vocabularyEntries, key) {
  return (vocabularyEntries || []).find((entry) => entry.key === key) || null;
}

function findAdjacentKey({ entries, currentKey, direction }) {
  const current = getOrderedEntry(entries, currentKey);
  if (!current) return null;

  const candidates = entries.filter((entry) =>
    direction === "higher" ? entry.level > current.level : entry.level < current.level,
  );

  candidates.sort((a, b) =>
    direction === "higher" ? a.level - b.level : b.level - a.level,
  );

  return candidates[0]?.key || null;
}

/**
 * Cambia un solo asse mantenendo invariato l'altro:
 * - duration: "dimmi di piu/meno";
 * - language: "piu semplice/troppo semplice".
 */
function findAdjacentRepresentation({ item, currentRepresentation, vocabulary, axis, direction }) {
  if (!["duration", "language"].includes(axis)) {
    throw new AppError("Asse di presentazione non valido", 400);
  }

  if (!["higher", "lower"].includes(direction)) {
    throw new AppError("Direzione di presentazione non valida", 400);
  }

  const adjacentKey =
    axis === "duration"
      ? findAdjacentKey({
          entries: vocabulary.durationTypes,
          currentKey: currentRepresentation.durationKey,
          direction,
        })
      : findAdjacentKey({
          entries: vocabulary.languageLevels,
          currentKey: currentRepresentation.languageLevelKey,
          direction,
        });

  if (!adjacentKey) return null;

  return (item.representations || []).find((representation) => {
    if (axis === "duration") {
      return (
        representation.durationKey === adjacentKey &&
        representation.languageLevelKey === currentRepresentation.languageLevelKey
      );
    }

    return (
      representation.languageLevelKey === adjacentKey &&
      representation.durationKey === currentRepresentation.durationKey
    );
  }) || null;
}

module.exports = {
  resolvePresentationPolicy,
  findRepresentationByPolicy,
  findAdjacentRepresentation,
};
