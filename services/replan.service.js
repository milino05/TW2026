const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
const ReplanProposal = require("../models/replanProposal.model");
const VisitSession = require("../models/visitSession.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { activeElapsedSeconds } = require("./visitSession.service");
const { generateVisitPlan } = require("./visitGenerator.service");

function id(value) { return String(value?._id || value || ""); }
function remainingOriginalSeconds(plan, currentStopIndex) {
  const stops = (plan.stops || []).slice(currentStopIndex + 1);
  const stopSeconds = stops.reduce((sum, stop) => sum + (Number(stop.estimatedContentSeconds) || 0) + (Number(stop.estimatedObservationSeconds) || 0), 0);
  const transitionSeconds = (plan.transitions || []).filter((transition) => transition.toStopIndex > currentStopIndex).reduce((sum, transition) => sum + (Number(transition.estimatedSeconds) || 0), 0);
  return stopSeconds + transitionSeconds;
}
async function inferCurrentPlace(plan, currentStopIndex, explicitPlaceId) {
  if (explicitPlaceId) return explicitPlaceId;
  const stop = plan.stops?.[currentStopIndex]; if (!stop || !plan.sourceLayoutRevisionId) return null;
  const layout = await MuseumLayoutRevision.findById(plan.sourceLayoutRevisionId).lean();
  const placement = (layout?.itemPlacements || []).find((entry) => id(entry.itemId) === id(stop.itemId)); return placement?.primaryPlaceId || null;
}
async function proposeReplan({ userId, planId, sessionId, currentStopIndex, currentPlaceId = null, reason = null }) {
  const [plan, session] = await Promise.all([GeneratedVisitPlan.findOne({ _id: planId, userId }).lean(), VisitSession.findOne({ _id: sessionId, userId, generatedVisitPlanId: planId, status: { $in: ["active", "paused"] } })]);
  if (!plan || !session) throw new AppError("Piano o sessione non trovati", 404);
  const index = Number.isInteger(Number(currentStopIndex)) ? Math.max(0, Number(currentStopIndex)) : session.currentStopIndex || 0;
  const elapsed = activeElapsedSeconds(session); const originalBudget = Number(plan.requestSnapshot?.timeBudgetSeconds) || Number(plan.estimatedTiming?.totalSeconds) || 1; const remainingBudget = Math.max(1, originalBudget - elapsed); const originalRemaining = remainingOriginalSeconds(plan, index);
  const ratio = originalRemaining > 0 ? remainingBudget / originalRemaining : 1;
  let resolvedReason = reason;
  if (!resolvedReason) {
    if (ratio >= 1 + policy.generator.replanTriggerRatio) resolvedReason = "ahead_of_schedule";
    else if (ratio <= 1 - policy.generator.replanTriggerRatio) resolvedReason = "behind_schedule";
    else throw new AppError("La deviazione temporale non giustifica ancora un replanning", 409, [{ code: "REPLAN_NOT_NEEDED", context: { ratio } }]);
  }
  if (!["ahead_of_schedule", "behind_schedule", "manual_request"].includes(resolvedReason)) throw new AppError("reason non valido", 400);
  const visitedIds = (plan.stops || []).slice(0, index + 1).map((stop) => stop.itemId); const originalFuture = (plan.stops || []).slice(index + 1);
  const stableInterests = originalFuture.map((stop) => ({ kind: "item", itemId: stop.itemId, weight: policy.generator.stabilityPenalty }));
  const originalRequest = plan.requestSnapshot || {}; const mustFuture = (originalRequest.mustSeeItemIds || []).filter((itemId) => !visitedIds.some((visited) => id(visited) === id(itemId)));
  const startPlaceId = await inferCurrentPlace(plan, index, currentPlaceId);
  const request = { ...originalRequest, timeBudgetSeconds: Math.round(remainingBudget), startPlaceId, excludedItemIds: [...new Set([...(originalRequest.excludedItemIds || []).map(id), ...visitedIds.map(id)])], mustSeeItemIds: mustFuture, interests: [...(originalRequest.interests || []), ...stableInterests] };
  const tail = await generateVisitPlan({ userId, museumId: plan.museumId, request, persist: false });
  const proposal = await ReplanProposal.create({ userId, sessionId, generatedVisitPlanId: planId, reason: resolvedReason, currentStopIndex: index, currentEstimate: { activeElapsedSeconds: Math.round(elapsed), remainingBudgetSeconds: Math.round(remainingBudget), currentPlanRemainingSeconds: Math.round(originalRemaining), deviationRatio: ratio }, proposedTail: tail, messageKey: resolvedReason === "ahead_of_schedule" ? "SUGGEST_EXTEND_VISIT" : resolvedReason === "behind_schedule" ? "SUGGEST_SHORTEN_VISIT" : "SUGGEST_REPLAN" });
  return proposal;
}

async function resolveReplanProposal({ userId, proposalId, accept }) {
  const proposal = await ReplanProposal.findOne({ _id: proposalId, userId, status: "pending" }); if (!proposal) throw new AppError("Proposta di replanning non trovata", 404);
  proposal.status = accept ? "accepted" : "rejected"; proposal.resolvedAt = new Date(); await proposal.save(); if (!accept) return { proposal, replacementPlan: null };
  const oldPlan = await GeneratedVisitPlan.findOne({ _id: proposal.generatedVisitPlanId, userId }); if (!oldPlan) throw new AppError("Piano originale non trovato", 404);
  const tail = proposal.proposedTail || {}; const prefixStops = oldPlan.stops.slice(0, proposal.currentStopIndex + 1).map((stop) => stop.toObject ? stop.toObject() : stop); const offset = prefixStops.length;
  const prefixTransitions = oldPlan.transitions.filter((transition) => transition.toStopIndex <= proposal.currentStopIndex).map((transition) => transition.toObject ? transition.toObject() : transition);
  const tailTransitions = (tail.transitions || []).map((transition) => ({ ...transition, fromStopIndex: transition.fromStopIndex < 0 ? offset - 1 : transition.fromStopIndex + offset, toStopIndex: transition.toStopIndex + offset }));
  const prefixContent = prefixStops.reduce((sum, stop) => sum + (Number(stop.estimatedContentSeconds) || 0), 0); const prefixObservation = prefixStops.reduce((sum, stop) => sum + (Number(stop.estimatedObservationSeconds) || 0), 0); const prefixLogistics = prefixTransitions.reduce((sum, transition) => sum + (Number(transition.estimatedSeconds) || 0), 0);
  const replacement = await GeneratedVisitPlan.create({ userId, museumId: oldPlan.museumId, status: "accepted", requestSnapshot: oldPlan.requestSnapshot, contextSnapshot: tail.contextSnapshot || oldPlan.contextSnapshot, sourceVocabularyRevisionId: tail.sourceVocabularyRevisionId || oldPlan.sourceVocabularyRevisionId, sourceLayoutRevisionId: tail.sourceLayoutRevisionId || oldPlan.sourceLayoutRevisionId, adaptivePolicyVersion: tail.adaptivePolicyVersion || oldPlan.adaptivePolicyVersion, stops: [...prefixStops, ...(tail.stops || [])], transitions: [...prefixTransitions, ...tailTransitions], estimatedTiming: { contentSeconds: Math.round(prefixContent + (tail.estimatedTiming?.contentSeconds || 0)), observationSeconds: Math.round(prefixObservation + (tail.estimatedTiming?.observationSeconds || 0)), logisticsSeconds: Math.round(prefixLogistics + (tail.estimatedTiming?.logisticsSeconds || 0)), totalSeconds: Math.round(prefixContent + prefixObservation + prefixLogistics + (tail.estimatedTiming?.totalSeconds || 0)), reservedSeconds: tail.estimatedTiming?.reservedSeconds || 0 }, utilityScore: (oldPlan.utilityScore || 0) + (tail.utilityScore || 0), explanation: { ...(oldPlan.explanation || {}), replanProposalId: proposal._id, replanReason: proposal.reason }, acceptedAt: new Date() });
  oldPlan.status = "superseded"; await oldPlan.save(); await VisitSession.updateOne({ _id: proposal.sessionId, userId }, { $set: { generatedVisitPlanId: replacement._id } });
  return { proposal, replacementPlan: replacement };
}

module.exports = { remainingOriginalSeconds, proposeReplan, resolveReplanProposal };
