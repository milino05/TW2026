/**
 * Stable algorithmic policy for the adaptive engine.
 * Learned behavioural values live in MongoDB profiles; this file contains only
 * cold-start fallbacks, safety bounds and algorithm rules.
 */
module.exports = Object.freeze({
  version: 2,
  coldStart: Object.freeze({
    movementSpeedMps: 1,
    observationSeconds: 45,
    paceFactors: Object.freeze({ calm: 0.8, normal: 1, fast: 1.2 }),
  }),
  movement: Object.freeze({ minSpeedMps: 0.1, maxSpeedMps: 3, maxHistoricalWeight: 0.7 }),
  pace: Object.freeze({ calmMax: 1 / 3, fastMin: 2 / 3 }),
  confidence: Object.freeze({ usableThreshold: 0.2, minimumSamples: 5, minimumContributors: 3, maximum: 0.98 }),
  routing: Object.freeze({ maxPreferredDetourRatio: 0.35, preferenceCostMultiplier: 0.4 }),
  learning: Object.freeze({ minimumReliability: 0.5, maxObservationSeconds: 30 * 60 }),
  interests: Object.freeze({
    recencyHalfLifeDays: 180,
    propagationDepth: 1,
    eventEvidence: Object.freeze({
      more_detail: 1,
      related_opened: 0.65,
      stop_completed: 0.2,
      stop_skipped: -0.7,
      manual_add: 1,
      manual_remove: -1,
      less_detail: -0.25,
    }),
  }),
  generator: Object.freeze({
    beamWidth: 24,
    branchCandidates: 14,
    maxStops: 24,
    minimumStopSeconds: 10,
    conservativeTimeReserveRatio: 0.08,
    replanTriggerRatio: 0.12,
    stabilityPenalty: 0.25,
    logisticsUtilityWeight: 0.8,
    localImprovementPasses: 2,
  }),
});
