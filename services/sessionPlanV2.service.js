const VisitV2 = require("../models/visitV2.model");
const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
const AppError = require("../utils/AppError");
const { resolveExecutableVisitRevisionV2 } = require("./visitExecutionAccessV2.service");
const { resolveInitialPresentation } = require("./presentationRuntimeV2.service");
const { id } = require("./physicalExecutionV2.service");
const { resolveNavigationPreparation } = require("./navigationPreparationV2.service");

function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function roleOf(entry) { return ["core", "recommended", "optional"].includes(entry?.role) ? entry.role : "recommended"; }

function visitRevisionSourceSnapshotV2({ visit, revision }) {
  const sourceById = new Map((revision.editorialSources || []).map((entry) => [id(entry._id), entry]));
  const contentEntries = (revision.contentEntries || []).map((entry) => {
    const source = sourceById.get(id(entry.editorialSourceId));
    if (!source) throw new AppError("ContentEntry senza EditorialSource risolvibile", 409);
    return {
      ...entry,
      sourceEditorialReleaseIds: [source.editorialReleaseId],
      generatedBaseline: null,
    };
  });
  const sourceLegHints = new Map((revision.logistics?.routeHints || []).map((entry) => [`${id(entry.fromAnchorId)}>${id(entry.toAnchorId)}`, entry]));
  return {
    origin: { sourceType: "visit", visitRevisionId: revision._id, generatedVisitPlanId: null },
    visitId: visit._id,
    visitRevisionId: revision._id,
    sourceEditorialReleaseIds: uniqueIds((revision.editorialSources || []).map((entry) => entry.editorialReleaseId)),
    visitBaseline: revision.presentationBaseline || null,
    navigationBaseline: null,
    contentEntries,
    sourceAnchors: revision.visitAnchors || [],
    sourceLegHints,
    reservedSeconds: 0,
    explanation: { source: "visit_revision", preVisitNotes: revision.logistics?.preVisitNotes || [] },
  };
}

async function visitSourceSnapshotV2({ userId, visitId }) {
  const visit = await VisitV2.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const { revision } = await resolveExecutableVisitRevisionV2({ visit, userId });
  return visitRevisionSourceSnapshotV2({ visit, revision });
}

function generatedPlanSourceSnapshotV2(plan) {
  const contentEntries = (plan.contentEntries || []).map((entry) => ({
    ...entry,
    generatedBaseline: {
      variantId: entry.variantId,
      representationId: entry.representationId,
      durationTypeDefinitionId: entry.durationTypeDefinitionId,
      languageLevelDefinitionId: entry.languageLevelDefinitionId,
      locale: entry.locale,
    },
  }));
  const sourceLegHints = new Map((plan.physicalRoute?.legs || []).map((entry) => [`${id(entry.fromAnchorId)}>${id(entry.toAnchorId)}`, entry]));
  return {
    origin: { sourceType: "generated_plan", visitRevisionId: null, generatedVisitPlanId: plan._id },
    generatedVisitPlanId: plan._id,
    sourceEditorialReleaseIds: uniqueIds(plan.sourceEditorialReleaseIds || []),
    visitBaseline: plan.contextSnapshot?.presentationPreference || null,
    navigationBaseline: {
      movementPacePreference: plan.requestSnapshot?.movementPacePreference ?? 0.5,
      routingProfileSelections: plan.contextSnapshot?.routingProfileSelections || plan.requestSnapshot?.routingProfileSelections || [],
      requirements: plan.contextSnapshot?.navigationRequirements || plan.requestSnapshot?.navigationRequirements || [],
    },
    contentEntries,
    sourceAnchors: plan.visitAnchors || [],
    sourceLegHints,
    reservedSeconds: Number(plan.estimatedTiming?.reservedSeconds) || 0,
    explanation: { source: "accepted_generated_plan", generationExplanation: plan.explanation || {} },
  };
}

async function generatedSourceSnapshotV2({ userId, planId }) {
  const plan = await GeneratedVisitPlanV2.findOne({ _id: planId, userId }).lean();
  if (!plan) throw new AppError("GeneratedVisitPlan non trovato", 404);
  if (plan.status !== "accepted") throw new AppError("Il GeneratedVisitPlan deve essere accettato prima dello start", 409);
  return generatedPlanSourceSnapshotV2(plan);
}

async function materializeContentEntries({ source, userPreference = null, explicitPreference = null }) {
  const releaseIds = uniqueIds(source.contentEntries.flatMap((entry) => entry.sourceEditorialReleaseIds || []));
  const releases = await EditorialRelease.find({ _id: { $in: releaseIds } }).lean();
  const releaseById = new Map(releases.map((entry) => [id(entry._id), entry]));
  const revisionIds = uniqueIds(source.contentEntries.map((entry) => entry.itemRevisionId));
  const revisions = await ItemRevisionV2.find({ _id: { $in: revisionIds } }).lean();
  const revisionById = new Map(revisions.map((entry) => [id(entry._id), entry]));
  const namespaceRevisionIds = uniqueIds(releases.map((entry) => entry.namespaceRevisionId));
  const namespaceRevisions = await NamespaceRevision.find({ _id: { $in: namespaceRevisionIds } }).lean();
  const namespaceRevisionById = new Map(namespaceRevisions.map((entry) => [id(entry._id), entry]));
  return source.contentEntries.map((entry) => {
    const revision = revisionById.get(id(entry.itemRevisionId));
    if (!revision || id(revision.itemEditionId) !== id(entry.itemEditionId)) throw new AppError("ItemRevision della sorgente non risolvibile", 409);
    const release = (entry.sourceEditorialReleaseIds || []).map((releaseId) => releaseById.get(id(releaseId))).find(Boolean);
    if (!release) throw new AppError("EditorialRelease della ContentEntry non risolvibile", 409);
    const namespaceRevision = namespaceRevisionById.get(id(release.namespaceRevisionId));
    if (!namespaceRevision) throw new AppError("NamespaceRevision della ContentEntry non risolvibile", 409);
    const baselinePresentation = resolveInitialPresentation({
      revision,
      namespaceRevision,
      generatedBaseline: entry.generatedBaseline,
      visitBaseline: source.visitBaseline,
      userPreference,
      explicitPreference,
    });
    return {
      _id: entry._id,
      sourceContentEntryId: entry._id,
      itemId: entry.itemId,
      itemEditionId: entry.itemEditionId,
      itemRevisionId: entry.itemRevisionId,
      namespaceRevisionId: namespaceRevision._id,
      sourceEditorialReleaseIds: entry.sourceEditorialReleaseIds || [],
      role: roleOf(entry),
      deliveryAnchorId: entry.deliveryAnchorId || null,
      baselinePresentation,
    };
  });
}

function timingFromMaterialized(contentEntries, visitAnchors, physicalRoute, reservedSeconds = 0) {
  const contentSeconds = contentEntries.reduce((sum, entry) => sum + (Number(entry.baselinePresentation?.estimatedContentSeconds) || 0), 0);
  const observationSeconds = (visitAnchors || []).reduce((sum, entry) => sum + (Number(entry.estimatedObservationSeconds) || 0), 0);
  const logisticsSeconds = (physicalRoute?.legs || []).reduce((sum, entry) => sum + (Number(entry.estimatedSeconds) || 0), 0);
  return { contentSeconds: Math.round(contentSeconds), observationSeconds: Math.round(observationSeconds), logisticsSeconds: Math.round(logisticsSeconds), totalSeconds: Math.round(contentSeconds + observationSeconds + logisticsSeconds), reservedSeconds: Math.round(Number(reservedSeconds) || 0) };
}

async function prepareInitialSessionPlan({ source, navigation, userPreference = null, explicitPreference = null }) {
  const [physical, contentEntries] = await Promise.all([
    resolveNavigationPreparation({ sourceAnchors: source.sourceAnchors, sourceLegHints: source.sourceLegHints, navigation }),
    materializeContentEntries({ source, userPreference, explicitPreference }),
  ]);
  const anchorIds = new Set((physical.visitAnchors || []).map((entry) => id(entry._id)));
  for (const entry of contentEntries) if (entry.deliveryAnchorId && !anchorIds.has(id(entry.deliveryAnchorId))) throw new AppError("ContentEntry punta a un VisitAnchor non risolto nella Session", 409);
  return {
    venuePins: physical.venuePins,
    speedMps: physical.speedMps,
    plan: {
      origin: source.origin,
      createdReason: "initial",
      fidelity: source.origin.sourceType === "visit" ? "preserve" : "adapt",
      executedThroughEntryIndex: -1,
      sourceEditorialReleaseIds: source.sourceEditorialReleaseIds || [],
      contentEntries,
      visitAnchors: physical.visitAnchors,
      physicalRoute: physical.physicalRoute,
      estimatedTiming: timingFromMaterialized(contentEntries, physical.visitAnchors, physical.physicalRoute, source.reservedSeconds),
      explanation: { ...(source.explanation || {}), physicalWarnings: physical.warnings || [] },
    },
  };
}

async function createInitialSessionPlan({ session, plan }) {
  const revision = await SessionPlanRevisionV2.create({ sessionId: session._id, version: 1, status: "active", ...plan });
  try {
    const pointer = await VisitSessionV2.updateOne({ _id: session._id, currentPlanRevisionId: null }, { $set: { currentPlanRevisionId: revision._id } });
    if (pointer.modifiedCount !== 1) throw new Error("Session possiede gia un piano corrente");
    session.currentPlanRevisionId = revision._id;
    return revision;
  } catch (error) {
    await SessionPlanRevisionV2.deleteOne({ _id: revision._id }).catch(() => {});
    throw new AppError("Impossibile inizializzare il SessionPlan v2", 500, [{ code: "SESSION_PLAN_INITIALIZATION_FAILED", message: error.message }]);
  }
}

async function getCurrentSessionPlanV2({ sessionId, userId, allowCompleted = false }) {
  const query = { _id: sessionId, userId };
  if (!allowCompleted) query.status = { $in: ["active", "paused", "route_completed"] };
  const session = await VisitSessionV2.findOne(query);
  if (!session) throw new AppError("Session v2 non trovata", 404);
  if (!session.currentPlanRevisionId) throw new AppError("Session senza SessionPlan", 409);
  const plan = await SessionPlanRevisionV2.findOne({ _id: session.currentPlanRevisionId, sessionId: session._id });
  if (!plan) throw new AppError("SessionPlan corrente non trovato", 409);
  return { session, plan };
}

module.exports = {
  roleOf,
  visitRevisionSourceSnapshotV2,
  visitSourceSnapshotV2,
  generatedPlanSourceSnapshotV2,
  generatedSourceSnapshotV2,
  materializeContentEntries,
  timingFromMaterialized,
  prepareInitialSessionPlan,
  createInitialSessionPlan,
  getCurrentSessionPlanV2,
};