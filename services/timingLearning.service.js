const ItemObservationProfile = require("../models/itemObservationProfile.model");
const VisitTimingProfile = require("../models/visitTimingProfile.model");
const { updateContributor, aggregate } = require("./collectiveLearning.service");
const { robustMedian } = require("./adaptiveLearning.service");
const policy = require("../config/adaptivePolicy");

function groupBy(values, keyFn) { const grouped = new Map(); for (const value of values) { const key = keyFn(value); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(value); } return grouped; }

async function updateItemObservationProfiles({ session, personalObservationBase }) {
  const validStops = (session.stopObservations || []).filter((entry) => (entry.reliability || 0) >= policy.learning.minimumReliability);
  const groups = groupBy(validStops, (entry) => String(entry.itemId));
  for (const observations of groups.values()) {
    const first = observations[0];
    const observed = robustMedian(observations.map((entry) => entry.postContentObservationSeconds));
    if (!Number.isFinite(observed)) continue;
    const factor = Number.isFinite(personalObservationBase) && personalObservationBase > 0 ? observed / personalObservationBase : 1;
    const factorScope = `item:${first.itemId}:factor`;
    const secondsScope = `item:${first.itemId}:seconds`;
    await updateContributor({ userId: session.userId, metricType: "item_observation_factor", scopeKey: factorScope, value: factor, sampleCount: observations.length });
    await updateContributor({ userId: session.userId, metricType: "item_observation_seconds", scopeKey: secondsScope, value: observed, sampleCount: observations.length });
    const [factorAggregate, secondsAggregate] = await Promise.all([aggregate("item_observation_factor", factorScope), aggregate("item_observation_seconds", secondsScope)]);
    await ItemObservationProfile.findOneAndUpdate({ itemId: first.itemId }, { $set: { observationFactor: factorAggregate.value || 1, typicalObservationSeconds: secondsAggregate.value, confidence: Math.max(factorAggregate.confidence, secondsAggregate.confidence), sampleCount: Math.max(factorAggregate.sampleCount, secondsAggregate.sampleCount), contributorCount: Math.max(factorAggregate.contributorCount, secondsAggregate.contributorCount), updatedAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
}

async function updateVisitTimingProfile({ session, summary }) {
  if (!Number.isFinite(summary.observedTotalSeconds) || !Number.isFinite(session.initialEstimatedTotalSeconds)) return null;
  const residual = summary.observedTotalSeconds - session.initialEstimatedTotalSeconds;
  const residualScope = `visit:${session.visitRevisionId}:residual`;
  const totalScope = `visit:${session.visitRevisionId}:total`;
  const sampleCount = Math.max(1, summary.validTransitionCount + summary.validStopCount);
  await updateContributor({ userId: session.userId, metricType: "visit_timing_residual", scopeKey: residualScope, value: residual, sampleCount });
  await updateContributor({ userId: session.userId, metricType: "visit_total_seconds", scopeKey: totalScope, value: summary.observedTotalSeconds, sampleCount });
  const [residualAggregate, totalAggregate] = await Promise.all([aggregate("visit_timing_residual", residualScope), aggregate("visit_total_seconds", totalScope)]);
  return VisitTimingProfile.findOneAndUpdate({ visitRevisionId: session.visitRevisionId }, { $set: { typicalResidualSeconds: residualAggregate.value || 0, typicalTotalSeconds: totalAggregate.value, lowerTypicalSeconds: totalAggregate.lower, upperTypicalSeconds: totalAggregate.upper, confidence: Math.max(residualAggregate.confidence, totalAggregate.confidence), sampleCount: Math.max(residualAggregate.sampleCount, totalAggregate.sampleCount), contributorCount: Math.max(residualAggregate.contributorCount, totalAggregate.contributorCount), updatedAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

module.exports = { updateItemObservationProfiles, updateVisitTimingProfile };
