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
  return (
    (item.representations || []).find(
      (representation) =>
        representation.durationKey === policy.durationKey &&
        representation.languageLevelKey === policy.languageLevelKey,
    ) || null
  );
}

function findDefaultRepresentation({ item }) {
  const defaults = (item.representations || []).filter(
    (representation) => representation.isDefault === true,
  );

  return defaults.length === 1 ? defaults[0] : null;
}

/**
 * Risoluzione iniziale esplicita:
 * - official: policy del museo, eventualmente sovrascritta dall'utente;
 * - community: default locale dell'item.
 *
 * Le preferenze custom cross-museum non vengono interpretate finche non viene
 * concordato un mapping tra vocabolari locali differenti.
 */
function resolveInitialRepresentation({ visit, item, userPreference }) {
  if (visit.kind === "community") {
    if (userPreference && userPreference.mode === "custom") {
      throw new AppError(
        "Le preferenze adattive per visite community non sono ancora configurate",
        409,
        [
          {
            field: "presentationPreference",
            code: "CROSS_VOCABULARY_MAPPING_REQUIRED",
            message:
              "Non e possibile confrontare automaticamente chiavi appartenenti a vocabolari di musei diversi",
          },
        ],
      );
    }

    return findDefaultRepresentation({ item });
  }

  const policy = resolvePresentationPolicy({
    defaultPresentationPolicy: visit.defaultPresentationPolicy,
    userPreference,
  });

  return findRepresentationByPolicy({ item, policy });
}

function levelMap(entries = []) {
  return new Map(entries.map((entry) => [entry.key, entry.level]));
}

/**
 * Cambia un solo asse mantenendo invariato l'altro e seleziona la prima
 * representation effettivamente disponibile nell'item, non soltanto il livello
 * immediatamente successivo configurato nel museo.
 */
function findAdjacentRepresentation({ item, currentRepresentation, vocabulary, axis, direction }) {
  if (!["duration", "language"].includes(axis)) {
    throw new AppError("Asse di presentazione non valido", 400);
  }

  if (!["higher", "lower"].includes(direction)) {
    throw new AppError("Direzione di presentazione non valida", 400);
  }

  const entries = axis === "duration" ? vocabulary.durationTypes : vocabulary.languageLevels;
  const levels = levelMap(entries);
  const currentKey =
    axis === "duration"
      ? currentRepresentation.durationKey
      : currentRepresentation.languageLevelKey;
  const currentLevel = levels.get(currentKey);

  if (!Number.isFinite(currentLevel)) return null;

  const candidates = (item.representations || []).filter((representation) => {
    if (
      axis === "duration" &&
      representation.languageLevelKey !== currentRepresentation.languageLevelKey
    ) {
      return false;
    }

    if (
      axis === "language" &&
      representation.durationKey !== currentRepresentation.durationKey
    ) {
      return false;
    }

    const candidateKey =
      axis === "duration" ? representation.durationKey : representation.languageLevelKey;
    const candidateLevel = levels.get(candidateKey);

    if (!Number.isFinite(candidateLevel)) return false;
    return direction === "higher" ? candidateLevel > currentLevel : candidateLevel < currentLevel;
  });

  candidates.sort((left, right) => {
    const leftKey = axis === "duration" ? left.durationKey : left.languageLevelKey;
    const rightKey = axis === "duration" ? right.durationKey : right.languageLevelKey;
    return direction === "higher"
      ? levels.get(leftKey) - levels.get(rightKey)
      : levels.get(rightKey) - levels.get(leftKey);
  });

  return candidates[0] || null;
}

module.exports = {
  resolvePresentationPolicy,
  findRepresentationByPolicy,
  findDefaultRepresentation,
  resolveInitialRepresentation,
  findAdjacentRepresentation,
};
