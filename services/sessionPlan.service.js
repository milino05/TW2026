const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
const VisitSession = require("../models/visitSession.model");
const SessionPlanRevision = require("../models/sessionPlanRevision.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { buildLogisticsPlan } = require("./logisticsPlan.service");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { id, timingFromPlan } = require("./physicalRoute.service");
function roleOf(entry) { return ["core", "recommended", "optional"].includes(entry?.role) ? entry.role : "recommended"; }
async function vocabularyRevisionIdsForEntries(entries) {
  const result = [];
  for (const museumId of [...new Set((entries || []).map((entry) => id(entry.museumId)).filter(Boolean))]) { const vocabulary = await getMuseumVocabulary(museumId); if (vocabulary.vocabularyRevisionId) result.push(vocabulary.vocabularyRevisionId); }
  return result;
}
async function visitSourceSnapshot({ userId, visitId, movementPacePreference = null, timeBudgetSeconds = null }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
  if (!revision) throw new AppError("Revisione pubblicata non trovata", 404);
  const plan = await buildLogisticsPlan({ userId, visitId, navigationOverride: Number.isFinite(Number(movementPacePreference)) ? { movementPacePreference: Number(movementPacePreference) } : {} });
  const coreEntries = plan.contentEntries.filter((entry) => roleOf(entry) === "core");
  const sourceVocabularyRevisionIds = await vocabularyRevisionIdsForEntries(plan.contentEntries);
  const budget = Number.isFinite(Number(timeBudgetSeconds)) && Number(timeBudgetSeconds) > 0 ? Number(timeBudgetSeconds) : Math.max(1, plan.estimatedTotalSeconds);
  return { origin: { sourceType: "visit", visitRevisionId: revision._id, generatedVisitPlanId: null }, requestSnapshot: { timeBudgetSeconds: budget, hardTimeBudget: Number.isFinite(Number(timeBudgetSeconds)), movementPacePreference: plan.navigation.movementPacePreference, navigationRequirements: plan.navigation.requirements || [], mustIncludeItemIds: coreEntries.map((entry) => entry.itemId), mustVisitItemIds: coreEntries.filter((entry) => entry.spatialMode === "target").map((entry) => entry.itemId), excludedItemIds: [], interests: [] }, contextSnapshot: { sourceVisitKind: visit.kind, navigation: plan.navigation, movementBaselineMps: plan.movementBaselineMps, paceFactor: plan.paceFactor, effectiveMovementSpeedMps: plan.effectiveMovementSpeedMps, observationBaselineSeconds: plan.observationBaselineSeconds }, sourceVocabularyRevisionIds, sourceLayoutRevisionIds: plan.sourceLayoutRevisionIds || [], contentEntries: plan.contentEntries, physicalRoute: plan.physicalRoute, estimatedTiming: timingFromPlan(plan.contentEntries, plan.physicalRoute), adaptivePolicyVersion: policy.version, explanation: { warnings: plan.warnings || [], sourceVisitResidualSeconds: plan.estimatedVisitResidualSeconds || 0 } };
}
async function generatedSourceSnapshot({ userId, planId }) {
  const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId }).lean(); if (!plan) throw new AppError("Piano generato non trovato", 404); if (plan.status !== "accepted") throw new AppError("Il piano deve essere accettato prima di iniziare", 409);
  return { origin: { sourceType: "generated_plan", visitRevisionId: null, generatedVisitPlanId: plan._id }, requestSnapshot: plan.requestSnapshot || {}, contextSnapshot: plan.contextSnapshot || {}, sourceVocabularyRevisionIds: plan.sourceVocabularyRevisionId ? [plan.sourceVocabularyRevisionId] : [], sourceLayoutRevisionIds: plan.sourceLayoutRevisionId ? [plan.sourceLayoutRevisionId] : [], contentEntries: plan.contentEntries || [], physicalRoute: plan.physicalRoute || { anchors: [], legs: [] }, estimatedTiming: plan.estimatedTiming || timingFromPlan(plan.contentEntries || [], plan.physicalRoute || {}), adaptivePolicyVersion: plan.adaptivePolicyVersion || policy.version, utilityScore: plan.utilityScore || 0, explanation: plan.explanation || {} };
}
async function createInitialSessionPlan({ session, sourceSnapshot }) {
  const revision = await SessionPlanRevision.create({ sessionId: session._id, version: 1, status: "active", origin: sourceSnapshot.origin, createdReason: "initial", fidelity: sourceSnapshot.origin.sourceType === "visit" ? "preserve" : "adapt", executedThroughEntryIndex: -1, requestSnapshot: sourceSnapshot.requestSnapshot, contextSnapshot: sourceSnapshot.contextSnapshot, sourceVocabularyRevisionIds: sourceSnapshot.sourceVocabularyRevisionIds || [], sourceLayoutRevisionIds: sourceSnapshot.sourceLayoutRevisionIds || [], adaptivePolicyVersion: sourceSnapshot.adaptivePolicyVersion || policy.version, contentEntries: sourceSnapshot.contentEntries || [], physicalRoute: sourceSnapshot.physicalRoute || { anchors: [], legs: [] }, estimatedTiming: sourceSnapshot.estimatedTiming || {}, utilityScore: sourceSnapshot.utilityScore || 0, explanation: sourceSnapshot.explanation || {} });
  session.currentPlanRevisionId = revision._id; await session.save(); return revision;
}
async function getCurrentSessionPlan({ sessionId, userId, allowCompleted = false }) { const query = { _id: sessionId, userId }; if (!allowCompleted) query.status = { $in: ["active", "paused", "route_completed"] }; const session = await VisitSession.findOne(query); if (!session) throw new AppError("Sessione non trovata", 404); if (!session.currentPlanRevisionId) throw new AppError("La sessione non ha un piano di esecuzione", 409); const plan = await SessionPlanRevision.findOne({ _id: session.currentPlanRevisionId, sessionId: session._id }); if (!plan) throw new AppError("Piano di sessione non trovato", 409); return { session, plan }; }
async function nextPlanVersion(sessionId) { const latest = await SessionPlanRevision.findOne({ sessionId }).sort({ version: -1 }).select("version").lean(); return (latest?.version || 0) + 1; }
module.exports = { id, roleOf, timingFromPlan, vocabularyRevisionIdsForEntries, visitSourceSnapshot, generatedSourceSnapshot, createInitialSessionPlan, getCurrentSessionPlan, nextPlanVersion };
