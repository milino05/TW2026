function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustMedian(values, { minFactor = 0.25, maxFactor = 4 } = {}) {
  const base = median(values);
  if (base === null || base === 0) return base;
  const filtered = values.filter((value) => Number.isFinite(value) && value >= base * minFactor && value <= base * maxFactor);
  return median(filtered);
}

function confidenceFromSamples(sampleCount, distinctUserCount = sampleCount) {
  const sampleComponent = 1 - Math.exp(-Math.max(0, sampleCount) / 12);
  const userComponent = 1 - Math.exp(-Math.max(0, distinctUserCount) / 8);
  return clamp(sampleComponent * userComponent, 0, 0.98);
}

function updateEstimate(current, observation, reliability = 1) {
  if (!Number.isFinite(observation)) return { ...current };
  const previousCount = Math.max(0, Number(current?.sampleCount) || 0);
  const previousValue = Number.isFinite(current?.value) ? Number(current.value) : observation;
  const effectiveWeight = clamp(Number(reliability) || 0, 0, 1);
  const alpha = clamp((0.35 / Math.sqrt(previousCount + 1)) * effectiveWeight, 0.02, 0.35);
  const value = previousCount === 0 ? observation : previousValue * (1 - alpha) + observation * alpha;
  const sampleCount = previousCount + (effectiveWeight > 0 ? 1 : 0);
  return { value, confidence: clamp(1 - Math.exp(-sampleCount / 10), 0, 0.98), sampleCount, updatedAt: new Date() };
}

function computeTransitionReliability({ distanceMeters, predictedSeconds, observedSeconds }) {
  if (![distanceMeters, predictedSeconds, observedSeconds].every(Number.isFinite)) return 0;
  if (distanceMeters < 2 || observedSeconds <= 0 || predictedSeconds <= 0) return 0;
  const ratio = observedSeconds / predictedSeconds;
  if (ratio < 0.25 || ratio > 6) return 0.15;
  if (ratio < 0.5 || ratio > 3) return 0.5;
  return 1;
}

function computeObservationReliability({ contentSeconds, totalStopSeconds, postContentObservationSeconds }) {
  if (![contentSeconds, totalStopSeconds, postContentObservationSeconds].every(Number.isFinite)) return 0;
  if (totalStopSeconds < contentSeconds || postContentObservationSeconds < 0) return 0;
  if (postContentObservationSeconds > 30 * 60) return 0.15;
  if (postContentObservationSeconds > 10 * 60) return 0.5;
  return 1;
}

function summarizeSession(session) {
  const transitions = (session.transitionObservations || []).filter((entry) => (entry.reliability ?? 1) >= 0.5);
  const stops = (session.stopObservations || []).filter((entry) => (entry.reliability ?? 1) >= 0.5);
  const speeds = transitions.map((entry) => entry.observedSeconds > 0 ? entry.distanceMeters / entry.observedSeconds : null).filter((value) => Number.isFinite(value) && value > 0.1 && value < 3);
  const correctionFactors = transitions.map((entry) => entry.predictedSeconds > 0 ? entry.observedSeconds / entry.predictedSeconds : null).filter((value) => Number.isFinite(value) && value >= 0.25 && value <= 4);
  const observationSeconds = stops.map((entry) => entry.postContentObservationSeconds).filter(Number.isFinite);
  return {
    estimatedSpeedMps: robustMedian(speeds),
    timeCorrectionFactor: robustMedian(correctionFactors),
    typicalPostContentObservationSeconds: robustMedian(observationSeconds),
    validTransitionCount: transitions.length,
    validStopCount: stops.length,
  };
}

function blendPrediction({ systemDefault, populationEstimate, itemOrEdgeEstimate, userEstimate, sessionEstimate }) {
  const candidates = [
    { estimate: systemDefault, weight: 0.2 },
    { estimate: populationEstimate, weight: populationEstimate?.confidence || 0 },
    { estimate: itemOrEdgeEstimate, weight: itemOrEdgeEstimate?.confidence || 0 },
    { estimate: userEstimate, weight: userEstimate?.confidence || 0 },
    { estimate: sessionEstimate, weight: sessionEstimate?.confidence || 0 },
  ].filter((entry) => Number.isFinite(entry.estimate?.value) && entry.weight > 0);
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  return candidates.reduce((sum, entry) => sum + entry.estimate.value * entry.weight, 0) / total;
}

module.exports = { clamp, median, robustMedian, confidenceFromSamples, updateEstimate, computeTransitionReliability, computeObservationReliability, summarizeSession, blendPrediction };
