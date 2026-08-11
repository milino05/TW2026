/**
 * Stable algorithmic policy for the adaptive engine.
 * Learned behavioural values live in MongoDB profiles; this file contains only
 * cold-start fallbacks, safety bounds and algorithm rules.
 */
module.exports = Object.freeze({
  version: 1,
  coldStart: Object.freeze({
    movementSpeedMps: 1,
    observationSeconds: 45,
    paceFactors: Object.freeze({ calm: 0.8, normal: 1, fast: 1.2 }),
  }),
  movement: Object.freeze({
    minSpeedMps: 0.1,
    maxSpeedMps: 3,
    maxHistoricalWeight: 0.7,
  }),
  pace: Object.freeze({
    calmMax: 1 / 3,
    fastMin: 2 / 3,
  }),
  confidence: Object.freeze({
    usableThreshold: 0.2,
    minimumSamples: 5,
    minimumContributors: 3,
    maximum: 0.98,
  }),
  routing: Object.freeze({
    maxPreferredDetourRatio: 0.35,
    preferenceCostMultiplier: 0.4,
  }),
  learning: Object.freeze({
    minimumReliability: 0.5,
    maxObservationSeconds: 30 * 60,
    recencyHalfLifeDays: 180,
  }),
});
