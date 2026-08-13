const VisitSession = require("../models/visitSession.model");
const SessionPlanRevision = require("../models/sessionPlanRevision.model");
const PlanChangeProposal = require("../models/plan_change_proposal.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const UserGenerationPreference = require("../models/userGenerationPreference.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { generateVisitPlan } = require("./visitGenerator.service");
const { activeElapsedSeconds } = require("./visitSession.service");
const { getCurrentSessionPlan, nextPlanVersion, timingFromStops, id } = require("./sessionPlan.service");

const FIDELITIES = ["preserve", "adapt", "regenerate"];
const REASONS = ["ahead_of_schedule", "behind_schedule", "manual_request", "refocus_future", "extend_visit", "parameter_change"];
const SCALARS = ["movementPacePreference", "depthPreference", "languageComplexityPreference", "observationEmphasis", "visitDensity", "discoveryPreference", "timeRiskTolerance"];

function interestIdentity(interest) {
  if (!interest) return "";
  if (interest.kind === "item") return `item:${id(interest.itemId)}`;
  if (interest.kind === "canonical") return `canonical:${String(interest.scheme || "").toLowerCase()}:${interest.id || interest.refId || ""}`;
  return `${interest.kind}:${interest.key || ""}`;
}

function mergeInterests(base = [], additions = [], replace = false) {
  const map = new Map();
  if (!replace) for (const interest of base || []) map.set(interestIdentity(interest), interest);
  for (const interest of additions || []) map.set(interestIdentity(interest), interest);
  return [...map.values()].filter((interest) => interestIdentity(interest));
}

function remainingSeconds(plan, currentStopIndex) {
  const stopSeconds = (plan.stops || []).slice(currentStopIndex + 1).reduce(
    (sum, stop) => sum + (Number(stop.estimatedContentSeconds) || 0) + (Number(stop.estimatedObservationSeconds) || 0),
    0,
  );
  const transitionSeconds = (plan.transitions || []).filter((transition) => transition.toStopIndex > currentStopIndex).reduce(
    (sum, transition) => sum + (Number(transition.estimatedSeconds) || 0),
    0,
  );
  return stopSeconds + transitionSeconds;
}

function segmentEndForMuseum(stops, currentStopIndex) {
  const museumId = id(stops[currentStopIndex]?.museumId);
  let end = currentStopIndex;
  for (let index = currentStopIndex + 1; index < stops.length; index += 1) {
    if (id(stops[index].museumId) !== museumId) break;
    end = index;
  }
  return end;
}

function copyTransition(transition) {
  return transition?.toObject ? transition.toObject() : { ...transition };
}

function buildLockedSuffix(plan, segmentEnd) {
  const suffixStops = (plan.stops || []).slice(segmentEnd + 1).map((stop) => stop.toObject ? stop.toObject() : { ...stop });
  const suffixTransitions = (plan.transitions || []).filter((transition) => transition.fromStopIndex >= segmentEnd + 1).map(copyTransition);
  const boundary = (plan.transitions || []).find((transition) => transition.fromStopIndex === segmentEnd && transition.toStopIndex === segmentEnd + 1);
  return { suffixStops, suffixTransitions, boundary: boundary ? copyTransition(boundary) : null };
}

function fixedSuffixSeconds(plan, segmentEnd) {
  const stopSeconds = (plan.stops || []).slice(segmentEnd + 1).reduce(
    (sum, stop) => sum + (Number(stop.estimatedContentSeconds) || 0) + (Number(stop.estimatedObservationSeconds) || 0),
    0,
  );
  const transitionSeconds = (plan.transitions || []).filter((transition) => transition.fromStopIndex >= segmentEnd).reduce(
    (sum, transition) => sum + (Number(transition.estimatedSeconds) || 0),
    0,
  );
  return stopSeconds + transitionSeconds;
}

function normalizeReason(payload, session, ratio) {
  if (payload.reason !== undefined) {
    if (!REASONS.includes(payload.reason)) throw new AppError("reason non valido", 400);
    return payload.reason;
  }
  if (session.status === "route_completed") return "extend_visit";
  if (ratio >= 1 + policy.generator.replanTriggerRatio) return "ahead_of_schedule";
  if (ratio <= 1 - policy.generator.replanTriggerRatio) return "behind_schedule";
  return "manual_request";
}

function defaultFidelity(plan, reason) {
  if (plan.origin?.sourceType !== "visit") return "adapt";
  if (["behind_schedule", "refocus_future", "parameter_change", "extend_visit"].includes(reason)) return "adapt";
  return "preserve";
}

function resolveFidelity(plan, reason, requested) {
  if (requested !== undefined && !FIDELITIES.includes(requested)) throw new AppError("fidelity non valida", 400);
  return requested || defaultFidelity(plan, reason);
}

function messageKey(reason) {
  if (reason === "ahead_of_schedule") return "SUGGEST_EXTEND_VISIT";
  if (reason === "behind_schedule") return "SUGGEST_SHORTEN_VISIT";
  if (reason === "refocus_future") return "SUGGEST_REFOCUS_VISIT";
  if (reason === "extend_visit") return "SUGGEST_CONTINUE_VISIT";
  return "SUGGEST_ADAPT_VISIT";
}

function roleForGeneratedStop(stop, originalRoles, must) {
  return originalRoles.get(id(stop.itemId)) || (must.has(id(stop.itemId)) ? "core" : "recommended");
}

async function currentPublishedLayout(museumId) {
  const stable = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!stable) throw new AppError("Il museo non ha un layout pubblicato", 409);
  const revision = await MuseumLayoutRevision.findById(stable.publishedRevisionId).lean();
  if (!revision || revision.integrity?.status !== "valid") throw new AppError("Il layout pubblicato non e disponibile o integro", 409);
  return revision;
}

async function inferCurrentPlace({ museumId, currentStop, explicitPlaceId }) {
  const layout = await currentPublishedLayout(museumId);
  if (explicitPlaceId) {
    if (!(layout.places || []).some((place) => id(place._id) === id(explicitPlaceId))) throw new AppError("currentPlaceId non appartiene al layout pubblicato corrente", 400);
    return explicitPlaceId;
  }
  const placement = (layout.itemPlacements || []).find((entry) => id(entry.itemId) === id(currentStop.itemId));
  if (!placement?.primaryPlaceId) throw new AppError("La tappa corrente non ha una posizione nel layout pubblicato", 409);
  return placement.primaryPlaceId;
}

function resolveRemainingBudget({ payload, session, currentRemainingBudget, reason }) {
  let requested = Number(payload.remainingTimeBudgetSeconds);
  if (!Number.isFinite(requested) || requested <= 0) requested = currentRemainingBudget;
  const additional = Number(payload.additionalTimeSeconds);
  if (Number.isFinite(additional) && additional > 0) requested = reason === "extend_visit" && session.status === "route_completed" ? additional : requested + additional;
  if (reason === "extend_visit" && session.status === "route_completed" && (!Number.isFinite(Number(payload.remainingTimeBudgetSeconds)) || Number(payload.remainingTimeBudgetSeconds) <= 0) && (!Number.isFinite(additional) || additional <= 0)) {
    throw new AppError("Per estendere una visita completata indicare il tempo aggiuntivo disponibile", 400);
  }
  return requested;
}

async function proposePlanChange({ userId, sessionId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlan({ sessionId, userId });
  if (session.status === "paused" && !["manual_request", "refocus_future", "parameter_change"].includes(payload.reason)) {
    throw new AppError("Riprendere la visita prima del replanning automatico", 409);
  }

  const maxIndex = Math.max(0, (plan.stops || []).length - 1);
  const requestedIndex = Number(payload.currentStopIndex);
  const currentStopIndex = session.status === "route_completed"
    ? maxIndex
    : Math.min(maxIndex, Number.isInteger(requestedIndex) ? Math.max(0, requestedIndex) : session.currentStopIndex || 0);
  const currentStop = plan.stops[currentStopIndex];
  if (!currentStop) throw new AppError("La sessione non ha una tappa corrente", 409);

  const elapsed = activeElapsedSeconds(session);
  const originalBudget = Number(plan.requestSnapshot?.timeBudgetSeconds) || Number(plan.estimatedTiming?.totalSeconds) || 1;
  const currentRemainingBudget = Math.max(1, originalBudget - elapsed);
  const originalRemaining = remainingSeconds(plan, currentStopIndex);
  const ratio = originalRemaining > 0 ? currentRemainingBudget / originalRemaining : 1;
  const reason = normalizeReason(payload, session, ratio);
  const fidelity = resolveFidelity(plan, reason, payload.fidelity);
  const requestedRemainingBudget = resolveRemainingBudget({ payload, session, currentRemainingBudget, reason });

  const segmentEnd = segmentEndForMuseum(plan.stops, currentStopIndex);
  const currentMuseumId = currentStop.museumId;
  const originalSegmentFuture = (plan.stops || []).slice(currentStopIndex + 1, segmentEnd + 1);
  const { suffixStops, suffixTransitions, boundary } = buildLockedSuffix(plan, segmentEnd);
  const suffixSeconds = fixedSuffixSeconds(plan, segmentEnd);
  if (suffixSeconds >= requestedRemainingBudget && suffixStops.length) {
    throw new AppError("Il tempo indicato non basta nemmeno per la parte multi-museo che rimane bloccata", 409, [{ code: "LOCKED_SUFFIX_EXCEEDS_TIME_BUDGET", context: { suffixSeconds, requestedRemainingBudget } }]);
  }
  const generationBudget = Math.max(1, requestedRemainingBudget - suffixSeconds);
  const visitedIds = (plan.stops || []).slice(0, currentStopIndex + 1).map((stop) => stop.itemId);
  const originalRoles = new Map(originalSegmentFuture.map((stop) => [id(stop.itemId), stop.role]));
  const explicitMust = (plan.requestSnapshot?.mustSeeItemIds || []).filter((itemId) => !visitedIds.some((visited) => id(visited) === id(itemId)));
  const fidelityMust = fidelity === "preserve"
    ? originalSegmentFuture.map((stop) => stop.itemId)
    : fidelity === "adapt"
      ? originalSegmentFuture.filter((stop) => stop.role === "core").map((stop) => stop.itemId)
      : [];
  const mustSeeItemIds = [...new Map([...explicitMust, ...fidelityMust, ...(payload.addMustSeeItemIds || [])].map((value) => [id(value), value])).values()]
    .filter((value) => !(payload.removeMustSeeItemIds || []).some((removed) => id(removed) === id(value)));
  const stabilityInterests = fidelity === "regenerate"
    ? []
    : originalSegmentFuture
      .filter((stop) => !mustSeeItemIds.some((itemId) => id(itemId) === id(stop.itemId)))
      .map((stop) => ({ kind: "item", itemId: stop.itemId, weight: fidelity === "preserve" ? 0.8 : policy.generator.stabilityPenalty }));

  const startPlaceId = await inferCurrentPlace({ museumId: currentMuseumId, currentStop, explicitPlaceId: payload.currentPlaceId });
  const request = {
    ...plan.requestSnapshot,
    timeBudgetSeconds: generationBudget,
    startPlaceId,
    hardTimeBudget: payload.hardTimeBudget === undefined ? true : payload.hardTimeBudget !== false,
    interests: mergeInterests(plan.requestSnapshot?.interests || [], [...(payload.interests || []), ...stabilityInterests], payload.replaceInterests === true),
    mustSeeItemIds,
    excludedItemIds: [...new Set([...(plan.requestSnapshot?.excludedItemIds || []).map(id), ...(payload.excludedItemIds || []).map(id), ...visitedIds.map(id)])],
  };
  for (const field of SCALARS) if (payload[field] !== undefined) request[field] = payload[field];
  if (Array.isArray(payload.navigationRequirements)) request.navigationRequirements = payload.navigationRequirements;

  const tail = await generateVisitPlan({ userId, museumId: currentMuseumId, request, persist: false });
  const mustSet = new Set(mustSeeItemIds.map(id));
  const generatedStops = (tail.stops || []).map((stop) => ({ ...stop, museumId: currentMuseumId, role: roleForGeneratedStop(stop, originalRoles, mustSet) }));
  const prefixStops = (plan.stops || []).slice(0, currentStopIndex + 1).map((stop) => stop.toObject ? stop.toObject() : { ...stop });
  const prefixTransitions = (plan.transitions || []).filter((transition) => transition.toStopIndex <= currentStopIndex).map(copyTransition);
  const offset = prefixStops.length;
  const generatedTransitions = (tail.transitions || []).map((transition) => ({
    ...transition,
    type: "indoor",
    fromStopIndex: transition.fromStopIndex < 0 ? offset - 1 : transition.fromStopIndex + offset,
    toStopIndex: transition.toStopIndex + offset,
  }));
  const suffixOffset = offset + generatedStops.length;
  const combinedTransitions = [...prefixTransitions, ...generatedTransitions];
  if (suffixStops.length && boundary) combinedTransitions.push({ ...boundary, fromStopIndex: Math.max(0, suffixOffset - 1), toStopIndex: suffixOffset });
  const oldSuffixStart = segmentEnd + 1;
  for (const transition of suffixTransitions) {
    combinedTransitions.push({
      ...transition,
      fromStopIndex: suffixOffset + (transition.fromStopIndex - oldSuffixStart),
      toStopIndex: suffixOffset + (transition.toStopIndex - oldSuffixStart),
    });
  }
  const combinedStops = [...prefixStops, ...generatedStops, ...suffixStops];
  const totalSessionBudgetSeconds = Math.round(elapsed + requestedRemainingBudget);
  const proposedRevision = {
    origin: plan.origin,
    createdReason: reason,
    fidelity,
    executedThroughStopIndex: currentStopIndex,
    requestSnapshot: { ...request, timeBudgetSeconds: totalSessionBudgetSeconds },
    contextSnapshot: tail.contextSnapshot || plan.contextSnapshot,
    sourceVocabularyRevisionIds: [...new Set([...(plan.sourceVocabularyRevisionIds || []).map(id), tail.sourceVocabularyRevisionId ? id(tail.sourceVocabularyRevisionId) : ""].filter(Boolean))],
    sourceLayoutRevisionIds: [...new Set([...(plan.sourceLayoutRevisionIds || []).map(id), tail.sourceLayoutRevisionId ? id(tail.sourceLayoutRevisionId) : ""].filter(Boolean))],
    adaptivePolicyVersion: tail.adaptivePolicyVersion || policy.version,
    stops: combinedStops,
    transitions: combinedTransitions,
    estimatedTiming: timingFromStops(combinedStops, combinedTransitions, tail.estimatedTiming?.reservedSeconds || 0),
    utilityScore: (Number(plan.utilityScore) || 0) + (Number(tail.utilityScore) || 0),
    explanation: { ...(plan.explanation || {}), adaptationReason: reason, fidelity, generatedMuseumId: currentMuseumId },
  };

  const proposal = await PlanChangeProposal.create({
    userId,
    sessionId: session._id,
    basePlanRevisionId: plan._id,
    reason,
    fidelity,
    currentStopIndex,
    adaptationRequest: payload,
    currentEstimate: {
      activeElapsedSeconds: Math.round(elapsed),
      remainingBudgetSeconds: Math.round(currentRemainingBudget),
      requestedRemainingBudgetSeconds: Math.round(requestedRemainingBudget),
      proposedTotalSessionBudgetSeconds: totalSessionBudgetSeconds,
      currentPlanRemainingSeconds: Math.round(originalRemaining),
      deviationRatio: ratio,
    },
    proposedRevision,
    messageKey: messageKey(reason),
  });

  if (["refocus_future", "extend_visit"].includes(reason)) {
    session.interactionEvents.push({
      type: reason === "refocus_future" ? "visit_refocus_requested" : "visit_extension_requested",
      itemId: payload.focusItemId || null,
      variantKey: currentStop.variantKey || null,
      metadata: { proposalId: proposal._id, museumId: currentMuseumId, interests: payload.interests || [] },
      at: new Date(),
    });
    await session.save();
  }
  return proposal;
}

async function rememberPreference(userId, request) {
  if (request.remember !== true) return null;
  const set = {};
  for (const field of SCALARS) if (request[field] !== undefined) set[field] = Number(request[field]);
  if (Array.isArray(request.navigationRequirements)) set.navigationRequirements = request.navigationRequirements;
  if (Array.isArray(request.interests)) {
    const existing = await UserGenerationPreference.findOne({ userId }).lean();
    set.interests = mergeInterests(existing?.interests || [], request.interests, request.replaceInterests === true);
  }
  if (!Object.keys(set).length) return null;
  return UserGenerationPreference.findOneAndUpdate(
    { userId },
    { $set: set },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function resolvePlanChangeProposal({ userId, proposalId, accept }) {
  const proposal = await PlanChangeProposal.findOne({ _id: proposalId, userId, status: "pending" });
  if (!proposal) throw new AppError("Proposta di modifica non trovata", 404);
  const session = await VisitSession.findOne({ _id: proposal.sessionId, userId });
  if (!session) throw new AppError("Sessione non trovata", 404);
  if (id(session.currentPlanRevisionId) !== id(proposal.basePlanRevisionId)) {
    proposal.status = "stale";
    proposal.resolvedAt = new Date();
    await proposal.save();
    throw new AppError("Il piano della sessione e gia cambiato; la proposta non e piu applicabile", 409);
  }

  proposal.status = accept ? "accepted" : "rejected";
  proposal.resolvedAt = new Date();
  await proposal.save();
  if (!accept) return { proposal, planRevision: null };

  const base = await SessionPlanRevision.findById(proposal.basePlanRevisionId);
  if (!base) throw new AppError("Piano base non trovato", 409);
  const data = proposal.proposedRevision || {};
  const revision = await SessionPlanRevision.create({
    sessionId: session._id,
    version: await nextPlanVersion(session._id),
    basedOnRevisionId: base._id,
    status: "active",
    origin: data.origin || base.origin,
    createdReason: proposal.reason,
    fidelity: proposal.fidelity,
    executedThroughStopIndex: proposal.currentStopIndex,
    requestSnapshot: data.requestSnapshot || {},
    contextSnapshot: data.contextSnapshot || {},
    sourceVocabularyRevisionIds: data.sourceVocabularyRevisionIds || [],
    sourceLayoutRevisionIds: data.sourceLayoutRevisionIds || [],
    adaptivePolicyVersion: data.adaptivePolicyVersion || policy.version,
    stops: data.stops || [],
    transitions: data.transitions || [],
    estimatedTiming: data.estimatedTiming || {},
    utilityScore: data.utilityScore || 0,
    explanation: data.explanation || {},
  });
  base.status = "superseded";
  await base.save();
  session.currentPlanRevisionId = revision._id;
  session.status = "active";
  session.routeCompletedAt = null;
  await session.save();
  await PlanChangeProposal.updateMany({ sessionId: session._id, status: "pending", _id: { $ne: proposal._id } }, { $set: { status: "stale", resolvedAt: new Date() } });
  const rememberedPreference = await rememberPreference(userId, proposal.adaptationRequest || {});
  return { proposal, planRevision: revision, rememberedPreference };
}

module.exports = {
  FIDELITIES,
  REASONS,
  mergeInterests,
  remainingSeconds,
  segmentEndForMuseum,
  defaultFidelity,
  proposePlanChange,
  resolvePlanChangeProposal,
};
