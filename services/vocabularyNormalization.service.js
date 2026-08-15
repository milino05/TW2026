function normalizedPosition(index, count) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError("index deve essere un intero non negativo");
  }
  if (!Number.isInteger(count) || count < 1 || index >= count) {
    throw new RangeError("count deve essere positivo e index deve appartenere all'array");
  }
  if (count === 1) return 0.5;
  return index / (count - 1);
}

function withNormalizedPositions(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry, index) => ({
    ...entry,
    normalizedPosition: normalizedPosition(index, entries.length),
  }));
}

function buildPositionMap(entries = []) {
  return new Map(
    withNormalizedPositions(entries).map((entry) => [entry.key, entry.normalizedPosition]),
  );
}

function buildDurationSecondsMap(durationTypes = []) {
  return new Map(durationTypes.map((entry) => [entry.key, entry.targetSeconds]));
}

module.exports = {
  normalizedPosition,
  withNormalizedPositions,
  buildPositionMap,
  buildDurationSecondsMap,
};
