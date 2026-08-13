const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
const VisitSession = require("../models/visitSession.model");
const SessionPlanRevision = require("../models/sessionPlanRevision.model");
const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { buildLogisticsPlan } = require("./logisticsPlan.service");

function id(value) { return String(value?._id || value || ""); }
function plain(value) { return value?.toObject ? value.toObject() : value; }
function roleOf(stop) { return ["core", "recommended", "optional"].includes(stop?.role) ? stop.role : "recommended"; }
function timingFromStops(stops, transitions, reservedSeconds = 0) {
  const contentSeconds = stops.reduce((sum, stop) => sum + (Number(stop.estimatedContentSeconds) || 0), 0);
  const observationSeconds = stops.reduce((sum, stop) => sum + (Number(stop.estimatedObservationSeconds) || 0), 0);
  const logisticsSeconds = transitions.reduce((sum, transition) => sum + (Number(transition.estimatedSeconds) || 0), 0);
  return { contentSeconds: Math.round(contentSeconds), observationSeconds: Math.round(observationSeconds), logisticsSeconds: Math.round(logisticsSeconds), totalSeconds: Math.round(contentSeconds + observationSeconds + logisticsSeconds), reservedSeconds: Math.round(reservedSeconds || 0) };
}

async function visitSourceSnapshot({ userId, visitId, movementPacePreference = null, timeBudgetSeconds = null }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
  if (!revision) throw new AppError("Revisione pubblicata della visita non trovata", 404);
  const plan = await buildLogisticsPlan({ userId, visitId, navigationOverride: Number.isFinite(Number(movementPacePreference)) ? { movementPacePreference: Number(movementPacePreference) } : {} });
  const observationPerStop = revision.stops.length ? plan.estimatedObservationSeconds / revision.stops.length : 0;
  const stops = plan.presentationPlan.stops.map((selected, index) => {
    const sourceStop = revision.stops[index];
    return {
      sourceStopId: sourceStop?._id || null,
      itemId: selected.itemId,
      itemRevisionId: selected.itemRevisionId,
      museumId: selected.museumId,
      role: roleOf(sourceStop),
      variantKey: selected.variantKey || selected.representation?.variantKey,
      representationId: selected.representation?._id || null,
      durationKey: selected.representation.durationKey,
      languageLevelKey: selected.representation.languageLevelKey,
      estimatedContentSeconds: selected.targetSeconds || 0,
      estimatedObservationSeconds: Math.round(observationPerStop),
      utilityScore: 0,
      scoreBreakdown: {},
      reasons: [{ source: "visit_source", message: visit.kind === "official" ? "Tappa della visita ufficiale" : "Tappa della visita community", confidence: 1 }],
    };
  });
  const transitions = (plan.transitions || []).map((transition) => ({
    type: transition.type || "indoor",
    fromStopIndex: transition.fromStopIndex,
    toStopIndex: transition.toStopIndex,
    layoutRevisionId: transition.layoutRevisionId || null,
    fromPlaceId: transition.fromPlaceId || null,
    toPlaceId: transition.toPlaceId || null,
    path: transition.path || [],
    estimatedSeconds: transition.estimatedSeconds || 0,
    preferencePenalty: transition.preferencePenalty || 0,
    instruction: transition.instructionOverride || transition.instruction || null,
    communityNote: transition.communityNote || null,
  }));
  return {
    origin: { sourceType: "visit", visitRevisionId: revision._id, generatedVisitPlanId: null },
    requestSnapshot: {
      timeBudgetSeconds: Number.isFinite(Number(timeBudgetSeconds)) && Number(timeBudgetSeconds) > 0 ? Number(timeBudgetSeconds) : Math.max(1, plan.estimatedTotalSeconds),
      hardTimeBudget: Number.isFinite(Number(timeBudgetSeconds)),
      movementPacePreference: plan.navigation.movementPacePreference,
      navigationRequirements: plan.navigation.requirements || [],
      mustSeeItemIds: revision.stops.filter((stop) => roleOf(stop) === "core").map((stop) => stop.itemId),
      excludedItemIds: [],
      interests: [],
    },
    contextSnapshot: {
      sourceVisitKind: visit.kind,
      navigation: plan.navigation,
      movementBaselineMps: plan.movementBaselineMps,
      paceFactor: plan.paceFactor,
      effectiveMovementSpeedMps: plan.effectiveMovementSpeedMps,
      observationBaselineSeconds: plan.observationBaselineSeconds,
    },
    sourceVocabularyRevisionIds: [],
    sourceLayoutRevisionIds: [...new Set(transitions.map((transition) => id(transition.layoutRevisionId)).filter(Boolean))],
    stops,
    transitions,
    estimatedTiming: timingFromStops(stops, transitions),
    adaptivePolicyVersion: policy.version,
  };
}

async function generatedSourceSnapshot({ userId, planId }) {
  const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId }).lean();
  if (!plan) throw new AppError("Piano generato non trovato", 404);
  if (plan.status !== "accepted") throw new AppError("Il piano deve essere accettato prima di iniziare", 409);
  const must = new Set((plan.requestSnapshot?.mustSeeItemIds || []).map(id));
  const stops = [];
  for (const stop of plan.stops || []) {
    const item = await Item.findById(stop.itemId).lean();
    if (!item) continue;
    stops.push({ ...plain(stop), museumId: item.museumId, role: must.has(id(stop.itemId)) ? "core" : "recommended" });
  }
  const transitions = (plan.transitions || []).map((transition) => ({ ...plain(transition), type: "indoor" }));
  return {
    origin: { sourceType: "generated_plan", visitRevisionId: null, generatedVisitPlanId: plan._id },
    requestSnapshot: plan.requestSnapshot || {},
    contextSnapshot: plan.contextSnapshot || {},
    sourceVocabularyRevisionIds: plan.sourceVocabularyRevisionId ? [plan.sourceVocabularyRevisionId] : [],
    sourceLayoutRevisionIds: plan.sourceLayoutRevisionId ? [plan.sourceLayoutRevisionId] : [],
    stops,
    transitions,
    estimatedTiming: plan.estimatedTiming || timingFromStops(stops, transitions),
    adaptivePolicyVersion: plan.adaptivePolicyVersion || policy.version,
    utilityScore: plan.utilityScore || 0,
    explanation: plan.explanation || {},
  };
}

async function createInitialSessionPlan({ session, sourceSnapshot }) {
  const revision = await SessionPlanRevision.create({ sessionId: session._id, version: 1, status: "active", origin: sourceSnapshot.origin, createdReason: "initial", fidelity: sourceSnapshot.origin.sourceType === "visit" ? "preserve" : "adapt", executedThroughStopIndex: -1, requestSnapshot: sourceSnapshot.requestSnapshot, contextSnapshot: sourceSnapshot.contextSnapshot, sourceVocabularyRevisionIds: sourceSnapshot.sourceVocabularyRevisionIds || [], sourceLayoutRevisionIds: sourceSnapshot.sourceLayoutRevisionIds || [], adaptivePolicyVersion: sourceSnapshot.adaptivePolicyVersion || policy.version, stops: sourceSnapshot.stops || [], transitions: sourceSnapshot.transitions || [], estimatedTiming: sourceSnapshot.estimatedTiming || {}, utilityScore: sourceSnapshot.utilityScore || 0, explanation: sourceSnapshot.explanation || {} });
  session.currentPlanRevisionId = revision._id;
  await session.save();
  return revision;
}

async function getCurrentSessionPlan({ sessionId, userId, allowCompleted = false }) {
  const query = { _id: sessionId, userId };
  if (!allowCompleted) query.status = { $in: ["active", "paused", "route_completed"] };
  const session = await VisitSession.findOne(query);
  if (!session) throw new AppError("Sessione non trovata", 404);
  if (!session.currentPlanRevisionId) throw new AppError("La sessione non ha un piano di esecuzione", 409);
  const plan = await SessionPlanRevision.findOne({ _id: session.currentPlanRevisionId, sessionId: session._id });
  if (!plan) throw new AppError("Piano di sessione non trovato", 409);
  return { session, plan };
}

async function nextPlanVersion(sessionId) {
  const latest = await SessionPlanRevision.findOne({ sessionId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

module.exports = { id, roleOf, timingFromStops, visitSourceSnapshot, generatedSourceSnapshot, createInitialSessionPlan, getCurrentSessionPlan, nextPlanVersion };
