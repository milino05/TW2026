const User = require("../models/user");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const Venue = require("../models/venue.model");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
const ExecutionPreparation = require("../models/executionPreparation.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { assertCanExecuteVisitV2, resolveExecutableVisitRevisionV2 } = require("./visitExecutionAccessV2.service");
const {
  visitRevisionSourceSnapshotV2,
  generatedPlanSourceSnapshotV2,
  prepareInitialSessionPlan,
  createInitialSessionPlan,
} = require("./sessionPlanV2.service");
const { currentSessionProjection } = require("./visitSessionV2.service");

const DEFAULT_TTL_SECONDS = 30 * 60;

function id(value) { return String(value?._id || value || ""); }
function validUnit(value) { return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1; }
function ttlSeconds() {
  const configured = Number(process.env.EXECUTION_PREPARATION_TTL_SECONDS);
  return Number.isFinite(configured) && configured >= 60 ? Math.floor(configured) : DEFAULT_TTL_SECONDS;
}
function expiryFromNow(now = new Date()) {
  return new Date(now.getTime() + ttlSeconds() * 1000);
}
function assertNotExpired(preparation, now = new Date()) {
  if (preparation.expiresAt && new Date(preparation.expiresAt) <= now) {
    throw new AppError("ExecutionPreparation scaduta", 409, [{ code: "PREPARATION_EXPIRED" }]);
  }
}
function normalizePresentationPreference(stored = null, override = null) {
  const result = {
    depthPreference: validUnit(override?.depthPreference)
      ? Number(override.depthPreference)
      : validUnit(stored?.depthPreference) ? Number(stored.depthPreference) : null,
    languageComplexityPreference: validUnit(override?.languageComplexityPreference)
      ? Number(override.languageComplexityPreference)
      : validUnit(stored?.languageComplexityPreference) ? Number(stored.languageComplexityPreference) : null,
    locale: typeof override?.locale === "string" && override.locale.trim() ? override.locale.trim() : null,
  };
  return Object.values(result).some((value) => value !== null) ? result : null;
}
function normalizeNavigation(stored = {}, draft = {}) {
  return {
    movementPacePreference: validUnit(draft.movementPacePreference)
      ? Number(draft.movementPacePreference)
      : validUnit(stored?.movementPacePreference) ? Number(stored.movementPacePreference) : 0.5,
    requirements: Array.isArray(draft.navigationRequirements)
      ? draft.navigationRequirements
      : Array.isArray(stored?.requirements) ? stored.requirements : [],
  };
}
function normalizedDraft(payload = {}) {
  const draft = {};
  if (payload.presentationPreference && typeof payload.presentationPreference === "object") {
    draft.presentationPreference = {
      ...(validUnit(payload.presentationPreference.depthPreference) ? { depthPreference: Number(payload.presentationPreference.depthPreference) } : {}),
      ...(validUnit(payload.presentationPreference.languageComplexityPreference) ? { languageComplexityPreference: Number(payload.presentationPreference.languageComplexityPreference) } : {}),
      ...(typeof payload.presentationPreference.locale === "string" && payload.presentationPreference.locale.trim()
        ? { locale: payload.presentationPreference.locale.trim() }
        : {}),
    };
  }
  if (validUnit(payload.movementPacePreference)) draft.movementPacePreference = Number(payload.movementPacePreference);
  if (Array.isArray(payload.navigationRequirements)) draft.navigationRequirements = payload.navigationRequirements;
  return draft;
}
function mergeDraft(current = {}, patch = {}) {
  const next = { ...current, ...patch };
  if (current.presentationPreference || patch.presentationPreference) {
    next.presentationPreference = { ...(current.presentationPreference || {}), ...(patch.presentationPreference || {}) };
  }
  return next;
}

async function resolveExactSource({ userId, payload = {} }) {
  const hasVisit = Boolean(payload.visitId);
  const hasPlan = Boolean(payload.generatedVisitPlanId);
  if (hasVisit === hasPlan) {
    throw new AppError("Indicare esattamente una source Visit o GeneratedPlan", 400, [{ code: "EXECUTION_SOURCE_REQUIRED" }]);
  }
  if (hasVisit) {
    const visit = await VisitV2.findOne({ _id: payload.visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
    if (!visit) throw new AppError("Visit eseguibile non disponibile", 404);
    const { access, revision } = await resolveExecutableVisitRevisionV2({ visit, userId });
    return {
      identity: {
        sourceType: "visit",
        visitId: visit._id,
        visitRevisionId: revision._id,
        generatedVisitPlanId: null,
        versionPolicy: access.entitlement?.versionPolicy === "pinned" ? "pinned" : "follow_current",
      },
      sourceSnapshot: visitRevisionSourceSnapshotV2({ visit, revision }),
    };
  }
  const plan = await GeneratedVisitPlanV2.findOne({ _id: payload.generatedVisitPlanId, userId }).lean();
  if (!plan) throw new AppError("GeneratedVisitPlan non disponibile", 404);
  if (plan.status !== "accepted") throw new AppError("Il GeneratedVisitPlan deve essere accettato", 409);
  return {
    identity: {
      sourceType: "generated_plan",
      visitId: null,
      visitRevisionId: null,
      generatedVisitPlanId: plan._id,
      versionPolicy: "fixed_generated_plan",
    },
    sourceSnapshot: generatedPlanSourceSnapshotV2(plan),
  };
}

async function loadExactSourceForPreparation(preparation, { revalidateAuthorization = true } = {}) {
  const source = preparation.source;
  if (source.sourceType === "visit") {
    const visit = await VisitV2.findOne({ _id: source.visitId, lifecycleStatus: "active" }).lean();
    if (!visit) throw new AppError("Visit della preparation non disponibile", 409, [{ code: "PREPARATION_SOURCE_UNAVAILABLE" }]);
    if (revalidateAuthorization) await assertCanExecuteVisitV2(visit, preparation.userId);
    const revision = await VisitRevisionV2.findOne({
      _id: source.visitRevisionId,
      visitId: visit._id,
      status: { $in: ["published", "superseded"] },
    }).lean();
    if (!revision) throw new AppError("VisitRevision pinzata dalla preparation non disponibile", 409, [{ code: "PREPARATION_SOURCE_UNAVAILABLE" }]);
    return visitRevisionSourceSnapshotV2({ visit, revision });
  }
  const plan = await GeneratedVisitPlanV2.findOne({ _id: source.generatedVisitPlanId, userId: preparation.userId }).lean();
  if (!plan || plan.status !== "accepted") {
    throw new AppError("GeneratedVisitPlan della preparation non disponibile", 409, [{ code: "PREPARATION_SOURCE_UNAVAILABLE" }]);
  }
  return generatedPlanSourceSnapshotV2(plan);
}

function projectWarning(warning) {
  const code = warning?.code || "NAVIGATION_WARNING";
  const messages = {
    PREFERRED_ATTRIBUTE_UNSUPPORTED: "Una preferenza di percorso non e disponibile in una delle sedi.",
  };
  return { code, message: messages[code] || "La preparazione contiene un avviso di navigazione." };
}
function buildLogisticsPreview(prepared) {
  const timing = prepared.plan.estimatedTiming || {};
  const legs = prepared.plan.physicalRoute?.legs || [];
  return {
    estimatedTotalSeconds: Number(timing.totalSeconds) || 0,
    breakdown: {
      contentSeconds: Number(timing.contentSeconds) || 0,
      observationSeconds: Number(timing.observationSeconds) || 0,
      travelSeconds: Number(timing.logisticsSeconds) || 0,
    },
    reservedSeconds: Number(timing.reservedSeconds) || 0,
    routeSummary: {
      stopCount: (prepared.plan.visitAnchors || []).length,
      legCount: legs.length,
      venueCount: (prepared.venuePins || []).length,
      interVenueLegCount: legs.filter((entry) => entry.type === "inter_venue").length,
    },
    warnings: (prepared.plan.explanation?.physicalWarnings || []).map(projectWarning),
  };
}
function buildReadiness(prepared) {
  return {
    status: "ready",
    blockers: [],
    warnings: (prepared.plan.explanation?.physicalWarnings || []).map(projectWarning),
  };
}
function publicProjection(preparation) {
  return {
    id: preparation._id,
    version: preparation.version,
    status: preparation.status,
    source: {
      sourceType: preparation.source.sourceType,
      visitId: preparation.source.visitId || null,
      visitRevisionId: preparation.source.visitRevisionId || null,
      generatedVisitPlanId: preparation.source.generatedVisitPlanId || null,
      versionPolicy: preparation.source.versionPolicy,
    },
    effectivePresentationPreference: preparation.effectivePresentationPreference || null,
    navigation: {
      movementPacePreference: preparation.navigationSnapshot.movementPacePreference,
    },
    readiness: preparation.readiness,
    logisticsPreview: preparation.logisticsPreview,
    expiresAt: preparation.expiresAt,
    sessionId: preparation.sessionId || null,
  };
}

async function createExecutionPreparation({ userId, payload = {} }) {
  const user = await User.findOne({ _id: userId, status: "active" }).lean();
  if (!user) throw new AppError("Utente non disponibile", 404);
  const resolved = await resolveExactSource({ userId, payload });
  const draft = normalizedDraft(payload);
  const presentation = normalizePresentationPreference(user.defaultPresentationPreference, draft.presentationPreference);
  const navigation = normalizeNavigation(user.defaultNavigationPreference, draft);
  const prepared = await prepareInitialSessionPlan({
    source: resolved.sourceSnapshot,
    navigation,
    userPreference: null,
    explicitPreference: presentation,
  });
  const preparation = await ExecutionPreparation.create({
    userId,
    source: resolved.identity,
    version: 1,
    status: "active",
    preparationDraft: draft,
    effectivePresentationPreference: presentation,
    navigationSnapshot: navigation,
    venuePins: prepared.venuePins,
    sessionMovementSpeedMps: prepared.speedMps,
    adaptivePolicyVersion: policy.version,
    preparedPlanCandidate: prepared.plan,
    readiness: buildReadiness(prepared),
    logisticsPreview: buildLogisticsPreview(prepared),
    expiresAt: expiryFromNow(),
  });
  return publicProjection(preparation.toObject());
}

async function updateExecutionPreparation({ preparationId, userId, expectedVersion, payload = {} }) {
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
    throw new AppError("expectedVersion e obbligatoria", 400, [{ field: "expectedVersion", code: "REQUIRED" }]);
  }
  const preparation = await ExecutionPreparation.findOne({ _id: preparationId, userId, status: "active" }).lean();
  if (!preparation) throw new AppError("ExecutionPreparation attiva non trovata", 404);
  assertNotExpired(preparation);
  if (preparation.version !== Number(expectedVersion)) {
    throw new AppError("ExecutionPreparation modificata", 409, [{ code: "PREPARATION_VERSION_CONFLICT", context: { currentVersion: preparation.version } }]);
  }
  const patch = normalizedDraft(payload);
  const draft = mergeDraft(preparation.preparationDraft || {}, patch);
  const presentation = normalizePresentationPreference(preparation.effectivePresentationPreference, patch.presentationPreference);
  const navigation = normalizeNavigation(preparation.navigationSnapshot, draft);
  const sourceSnapshot = await loadExactSourceForPreparation(preparation);
  const prepared = await prepareInitialSessionPlan({ source: sourceSnapshot, navigation, userPreference: null, explicitPreference: presentation });
  const nextVersion = preparation.version + 1;
  const updated = await ExecutionPreparation.findOneAndUpdate(
    { _id: preparation._id, userId, status: "active", version: preparation.version },
    { $set: {
      version: nextVersion,
      preparationDraft: draft,
      effectivePresentationPreference: presentation,
      navigationSnapshot: navigation,
      venuePins: prepared.venuePins,
      sessionMovementSpeedMps: prepared.speedMps,
      adaptivePolicyVersion: policy.version,
      preparedPlanCandidate: prepared.plan,
      readiness: buildReadiness(prepared),
      logisticsPreview: buildLogisticsPreview(prepared),
      expiresAt: expiryFromNow(),
    } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError("ExecutionPreparation modificata durante il ricalcolo", 409, [{ code: "PREPARATION_VERSION_CONFLICT" }]);
  return publicProjection(updated);
}

async function assertPhysicalSnapshotCurrent(preparation) {
  const pins = preparation.venuePins || [];
  if (!pins.length) return;
  const venues = await Venue.find({ _id: { $in: pins.map((entry) => entry.venueId) }, lifecycleStatus: "active" }).select("_id publishedReleaseId").lean();
  const current = new Map(venues.map((entry) => [id(entry._id), id(entry.publishedReleaseId)]));
  const changed = pins.find((pin) => current.get(id(pin.venueId)) !== id(pin.venueReleaseId));
  if (changed) {
    throw new AppError("Lo stato fisico della Venue e cambiato dalla preparation", 409, [{
      code: "PREPARATION_PHYSICAL_STATE_CHANGED",
      context: { venueId: changed.venueId },
    }]);
  }
}

async function consumedStartResult(preparation, userId) {
  if (!preparation.sessionId) throw new AppError("Preparation consumata senza Session", 500);
  const session = await VisitSessionV2.findOne({ _id: preparation.sessionId, userId });
  if (!session) throw new AppError("Session della preparation non disponibile", 409);
  return {
    session,
    current: await currentSessionProjection({ sessionId: session._id, userId }),
    preparation: publicProjection(preparation),
    alreadyStarted: true,
  };
}

async function startExecutionPreparation({ preparationId, userId, expectedVersion }) {
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
    throw new AppError("expectedVersion e obbligatoria", 400, [{ field: "expectedVersion", code: "REQUIRED" }]);
  }
  let preparation = await ExecutionPreparation.findOne({ _id: preparationId, userId });
  if (!preparation) throw new AppError("ExecutionPreparation non trovata", 404);
  assertNotExpired(preparation);
  if (preparation.status === "consumed") return consumedStartResult(preparation.toObject(), userId);
  if (preparation.status !== "active") throw new AppError("ExecutionPreparation in avvio", 409, [{ code: "PREPARATION_START_IN_PROGRESS" }]);
  if (preparation.version !== Number(expectedVersion)) {
    throw new AppError("ExecutionPreparation modificata", 409, [{ code: "PREPARATION_VERSION_CONFLICT", context: { currentVersion: preparation.version } }]);
  }

  const claim = await ExecutionPreparation.updateOne(
    { _id: preparation._id, userId, status: "active", version: preparation.version },
    { $set: { status: "starting" } },
  );
  if (claim.modifiedCount !== 1) {
    preparation = await ExecutionPreparation.findOne({ _id: preparation._id, userId });
    if (preparation?.status === "consumed") return consumedStartResult(preparation.toObject(), userId);
    throw new AppError("ExecutionPreparation in avvio", 409, [{ code: "PREPARATION_START_IN_PROGRESS" }]);
  }

  let session = null;
  try {
    const claimed = await ExecutionPreparation.findById(preparation._id).lean();
    await loadExactSourceForPreparation(claimed, { revalidateAuthorization: true });
    await assertPhysicalSnapshotCurrent(claimed);
    session = await VisitSessionV2.create({
      userId,
      sourceType: claimed.source.sourceType,
      visitId: claimed.source.visitId || null,
      visitRevisionId: claimed.source.visitRevisionId || null,
      generatedVisitPlanId: claimed.source.generatedVisitPlanId || null,
      venuePins: claimed.venuePins || [],
      navigationSnapshot: claimed.navigationSnapshot,
      sessionMovementSpeedMps: claimed.sessionMovementSpeedMps,
      adaptivePolicyVersion: claimed.adaptivePolicyVersion,
    });
    await createInitialSessionPlan({ session, plan: claimed.preparedPlanCandidate });
    const consumed = await ExecutionPreparation.findOneAndUpdate(
      { _id: claimed._id, userId, status: "starting", version: claimed.version },
      { $set: { status: "consumed", sessionId: session._id, consumedAt: new Date() } },
      { new: true },
    ).lean();
    if (!consumed) throw new Error("Impossibile marcare la preparation come consumata");
    return {
      session,
      current: await currentSessionProjection({ sessionId: session._id, userId }),
      preparation: publicProjection(consumed),
      alreadyStarted: false,
    };
  } catch (error) {
    if (session?._id) {
      await SessionPlanRevisionV2.deleteMany({ sessionId: session._id }).catch(() => {});
      await VisitSessionV2.deleteOne({ _id: session._id }).catch(() => {});
    }
    await ExecutionPreparation.updateOne(
      { _id: preparation._id, userId, status: "starting", version: preparation.version },
      { $set: { status: "active" } },
    ).catch(() => {});
    throw error;
  }
}

async function getExecutionPreparation({ preparationId, userId }) {
  const preparation = await ExecutionPreparation.findOne({ _id: preparationId, userId }).lean();
  if (!preparation) throw new AppError("ExecutionPreparation non trovata", 404);
  assertNotExpired(preparation);
  return publicProjection(preparation);
}

module.exports = {
  ttlSeconds,
  createExecutionPreparation,
  updateExecutionPreparation,
  startExecutionPreparation,
  getExecutionPreparation,
  assertPhysicalSnapshotCurrent,
};