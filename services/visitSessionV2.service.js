const User = require("../models/user");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { estimateConnectionSeconds } = require("./graphRouting.service");
const { computeTransitionReliability, computePhysicalObservationReliability, computeContentExperienceReliability } = require("./adaptiveLearning.service");
const { recordContentExposure, recordVenueTargetObservation } = require("./learningV2.service");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const { findAdjacentPresentation, resolvePresentationText, id } = require("./presentationRuntimeV2.service");
const { loadPinnedBundle, routeToIntentInSession } = require("./physicalExecutionV2.service");

function effectivePresentation(session, entry) {
  const override = (session.presentationOverrides || []).find((value) => id(value.contentEntryId) === id(entry._id));
  return override ? { variantId: override.variantId, representationId: override.representationId, durationTypeDefinitionId: override.durationTypeDefinitionId, languageLevelDefinitionId: override.languageLevelDefinitionId, locale: override.locale, estimatedContentSeconds: override.estimatedContentSeconds } : entry.baselinePresentation;
}
function anchorMap(plan) { return new Map((plan.visitAnchors || []).map((entry) => [id(entry._id), entry])); }
function effectiveAnchorForIndex(plan, index) {
  const anchors = anchorMap(plan);
  for (let cursor = Math.min(index, (plan.contentEntries || []).length - 1); cursor >= 0; cursor -= 1) {
    const anchorId = plan.contentEntries[cursor]?.deliveryAnchorId;
    if (anchorId && anchors.has(id(anchorId))) return anchors.get(id(anchorId));
  }
  return null;
}
async function entryRuntimeData(session, entry) {
  const [revision, namespaceRevision] = await Promise.all([ItemRevisionV2.findById(entry.itemRevisionId).lean(), NamespaceRevision.findById(entry.namespaceRevisionId).lean()]);
  if (!revision || !namespaceRevision) throw new AppError("Snapshot editoriale della Session non disponibile", 409);
  const presentation = effectivePresentation(session, entry);
  const text = resolvePresentationText({ revision, selection: presentation });
  const variant = (revision.presentationVariants || []).find((value) => id(value._id) === id(presentation.variantId));
  const aspectById = new Map((namespaceRevision.presentationAspects || []).map((value) => [String(value.definitionId), value]));
  return { revision, namespaceRevision, presentation: { ...presentation, text }, variant, presentationAspects: (variant?.presentationAspects || []).map((value) => ({ definitionId: value.definitionId, label: aspectById.get(String(value.definitionId))?.label || value.definitionId, weight: value.weight })) };
}
async function availableActions({ session, plan, entry, index, runtime }) {
  if (session.status === "completed" || session.status === "abandoned") return [];
  if (session.status === "paused") return ["RESUME", "COMPLETE"];
  const actions = [];
  if (session.status === "route_completed") actions.push("PREVIOUS", "ROUTE_TO_INTENT", "COMPLETE");
  else {
    if (index > 0) actions.push("PREVIOUS");
    actions.push("NEXT");
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "duration", direction: "up" })) actions.push("PRESENTATION_DEPTH_UP");
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "duration", direction: "down" })) actions.push("PRESENTATION_DEPTH_DOWN");
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "language", direction: "up" })) actions.push("PRESENTATION_LANGUAGE_UP");
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "language", direction: "down" })) actions.push("PRESENTATION_LANGUAGE_DOWN");
    if ((plan.visitAnchors || []).length) actions.push("ROUTE_TO_INTENT");
    actions.push("PAUSE", "COMPLETE");
  }
  return [...new Set(actions)];
}

async function currentSessionProjection({ sessionId, userId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId, allowCompleted: true });
  const entries = plan.contentEntries || [];
  if (!entries.length) return { session: { id: session._id, status: session.status, currentEntryIndex: 0 }, planRevisionId: plan._id, current: null, availableActions: session.status === "paused" ? ["RESUME", "COMPLETE"] : ["COMPLETE"] };
  const index = Math.min(Math.max(0, Number(session.currentEntryIndex) || 0), entries.length - 1), entry = entries[index], runtime = await entryRuntimeData(session, entry), anchor = effectiveAnchorForIndex(plan, index), nextEntry = entries[index + 1] || null, nextAnchorId = nextEntry?.deliveryAnchorId || null;
  const nextLeg = anchor && nextAnchorId ? (plan.physicalRoute?.legs || []).find((leg) => id(leg.fromAnchorId) === id(anchor._id) && id(leg.toAnchorId) === id(nextAnchorId)) || null : null;
  return {
    session: { id: session._id, status: session.status, sourceType: session.sourceType, currentEntryIndex: index, venuePins: session.venuePins },
    planRevisionId: plan._id,
    current: { contentEntryId: entry._id, role: entry.role, itemId: entry.itemId, itemEditionId: entry.itemEditionId, itemRevisionId: entry.itemRevisionId, label: runtime.revision.label, authorCredits: runtime.revision.authorCredits || [], license: runtime.revision.metadata?.license || null, provenance: runtime.revision.provenance || null, presentation: runtime.presentation, presentationAspects: runtime.presentationAspects, anchor: anchor ? { id: anchor._id, venueTargetId: anchor.venueTargetId, venueId: anchor.venueId, placeId: anchor.placeId } : null, nextPhysicalLeg: nextLeg },
    availableActions: await availableActions({ session, plan, entry, index, runtime }),
  };
}

async function advanceSession({ sessionId, userId, direction }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (!["active", "route_completed"].includes(session.status)) throw new AppError("Session non avanzabile nello stato corrente", 409);
  const entries = plan.contentEntries || [];
  if (!entries.length) throw new AppError("SessionPlan senza contenuti", 409);
  if (direction === "previous") {
    if (session.status === "route_completed") { session.status = "active"; session.routeCompletedAt = null; }
    else if (session.currentEntryIndex > 0) session.currentEntryIndex -= 1;
    else throw new AppError("Nessun contenuto precedente", 409);
  } else if (direction === "next") {
    if (session.status === "route_completed") throw new AppError("La sequenza della visita e terminata", 409);
    if (session.currentEntryIndex < entries.length - 1) session.currentEntryIndex += 1;
    else { session.status = "route_completed"; session.routeCompletedAt = new Date(); }
  } else throw new AppError("direction deve essere next o previous", 400);
  await session.save();
  return currentSessionProjection({ sessionId, userId });
}

async function changePresentationAxis({ sessionId, userId, axis, direction }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  if (!entry) throw new AppError("ContentEntry corrente non disponibile", 409);
  const runtime = await entryRuntimeData(session, entry), next = findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis, direction });
  if (!next) throw new AppError("Nessuna Representation adiacente disponibile", 409);
  const value = { contentEntryId: entry._id, variantId: next.variantId, representationId: next.representationId, durationTypeDefinitionId: next.durationTypeDefinitionId, languageLevelDefinitionId: next.languageLevelDefinitionId, locale: next.locale, estimatedContentSeconds: next.estimatedContentSeconds, updatedAt: new Date() };
  const existing = session.presentationOverrides.find((override) => id(override.contentEntryId) === id(entry._id));
  if (existing) Object.assign(existing, value); else session.presentationOverrides.push(value);
  const increased = direction === "up";
  session.interactionEvents.push({ type: axis === "duration" ? (increased ? "presentation_depth_increased" : "presentation_depth_decreased") : (increased ? "presentation_language_increased" : "presentation_language_decreased"), contentEntryId: entry._id, itemEditionId: entry.itemEditionId, variantId: next.variantId, representationId: next.representationId, metadata: { axis, direction }, at: new Date() });
  await session.save();
  return currentSessionProjection({ sessionId, userId });
}

async function recordContentEntryExperience({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  if (!entry) throw new AppError("ContentEntry corrente non disponibile", 409);
  if (payload.contentEntryId && id(payload.contentEntryId) !== id(entry._id)) throw new AppError("contentEntryId non coincide con il contenuto corrente", 409);
  const current = effectivePresentation(session, entry), contentSeconds = Number(payload.contentSeconds ?? current.estimatedContentSeconds), experiencedSeconds = Number(payload.experiencedSeconds), completionRatio = payload.completionRatio === undefined ? 1 : Number(payload.completionRatio), reliability = computeContentExperienceReliability({ contentSeconds, experiencedSeconds, completionRatio });
  if (!reliability) throw new AppError("Esperienza contenutistica non valida", 400);
  session.contentEntryExperiences.push({ contentEntryId: entry._id, itemEditionId: entry.itemEditionId, itemRevisionId: entry.itemRevisionId, variantId: current.variantId, representationId: current.representationId, contentSeconds, experiencedSeconds, completionRatio, reliability });
  if (completionRatio >= 0.95) session.interactionEvents.push({ type: "content_entry_completed", contentEntryId: entry._id, itemEditionId: entry.itemEditionId, variantId: current.variantId, representationId: current.representationId, at: new Date() });
  await session.save();
  return { experience: session.contentEntryExperiences.at(-1) };
}

async function recordVenueTargetObservationV2({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex], anchorId = payload.visitAnchorId || entry?.deliveryAnchorId, anchor = (plan.visitAnchors || []).find((value) => id(value._id) === id(anchorId));
  if (!anchor) throw new AppError("VisitAnchor non disponibile per l'osservazione", 409);
  const observedSeconds = Number(payload.observedSeconds), reliability = computePhysicalObservationReliability({ observedSeconds });
  if (!reliability) throw new AppError("Osservazione fisica non valida", 400);
  session.venueTargetObservations.push({ visitAnchorId: anchor._id, venueTargetId: anchor.venueTargetId, observedSeconds, reliability });
  await session.save();
  return { observation: session.venueTargetObservations.at(-1) };
}

async function recordTransitionV2({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const currentAnchor = effectiveAnchorForIndex(plan, session.currentEntryIndex), venueId = payload.venueId || currentAnchor?.venueId;
  if (!venueId) throw new AppError("venueId necessario per registrare la transizione", 400);
  const bundle = await loadPinnedBundle(session, venueId), connection = (bundle.layout.connections || []).find((entry) => id(entry._id) === id(payload.connectionId));
  if (!connection) throw new AppError("Connection non appartiene alla LayoutRevision pinzata", 400);
  const observedSeconds = Number(payload.observedSeconds), predictedSeconds = estimateConnectionSeconds(connection, { speedMps: session.sessionMovementSpeedMps, learnedResidualSeconds: 0 }), observedMovementSeconds = Math.max(0.1, observedSeconds - Math.max(0, Number(connection.additionalDelaySeconds) || 0)), speed = Number(connection.distanceMeters) > 0 ? Number(connection.distanceMeters) / observedMovementSeconds : null, reliability = computeTransitionReliability({ distanceMeters: Number(connection.distanceMeters), predictedSeconds, observedSeconds });
  session.transitionObservations.push({ venueId: bundle.pin.venueId, layoutRevisionId: bundle.pin.layoutRevisionId, connectionId: connection._id, distanceMeters: Number(connection.distanceMeters), predictedSeconds, observedSeconds, observedMovementSpeedMps: Number.isFinite(speed) ? speed : null, reliability });
  if (reliability >= policy.learning.minimumReliability && Number.isFinite(speed) && speed >= policy.movement.minSpeedMps && speed <= policy.movement.maxSpeedMps) session.sessionMovementSpeedMps = session.sessionMovementSpeedMps * 0.75 + speed * 0.25;
  await session.save();
  return { observation: session.transitionObservations.at(-1), sessionMovementSpeedMps: session.sessionMovementSpeedMps };
}

async function routeToIntentV2({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId }), currentAnchor = effectiveAnchorForIndex(plan, session.currentEntryIndex), venueId = payload.venueId || currentAnchor?.venueId, fromPlaceId = payload.fromPlaceId || currentAnchor?.placeId;
  if (!venueId || !fromPlaceId) throw new AppError("Per la navigazione serve una posizione logica esplicita o un VisitAnchor corrente", 409, [{ code: "MANUAL_LOCATION_REQUIRED" }]);
  return routeToIntentInSession({ session, venueId, fromPlaceId, intent: payload.intent });
}

async function pauseSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("Solo una Session attiva puo essere sospesa", 409);
  session.status = "paused"; session.pauseIntervals.push({ startedAt: new Date(), endedAt: null }); await session.save();
  return currentSessionProjection({ sessionId, userId });
}
async function resumeSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "paused") throw new AppError("Session non in pausa", 409);
  const interval = session.pauseIntervals.at(-1); if (interval && !interval.endedAt) interval.endedAt = new Date();
  session.status = "active"; await session.save();
  return currentSessionProjection({ sessionId, userId });
}
async function completeSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (!["active", "paused", "route_completed"].includes(session.status)) throw new AppError("Session non completabile", 409);
  if (session.status === "paused") { const interval = session.pauseIntervals.at(-1); if (interval && !interval.endedAt) interval.endedAt = new Date(); }
  session.status = "completed"; session.completedAt = new Date(); await session.save();
  const user = await User.findById(userId).select("learningPreferences").lean(), learning = { contentExposures: 0, physicalObservations: 0 };
  if (user?.learningPreferences?.personalHistory === true) {
    for (const experience of session.contentEntryExperiences || []) if ((experience.reliability || 0) >= policy.learning.minimumReliability) {
      await recordContentExposure({ userId, itemEditionId: experience.itemEditionId, itemRevisionId: experience.itemRevisionId, variantId: experience.variantId, representationId: experience.representationId, completionRatio: experience.completionRatio, now: session.completedAt });
      learning.contentExposures += 1;
    }
  }
  if (user?.learningPreferences?.collectiveContribution === true) {
    for (const observation of session.venueTargetObservations || []) if ((observation.reliability || 0) >= policy.learning.minimumReliability) {
      const result = await recordVenueTargetObservation({ userId, venueTargetId: observation.venueTargetId, observedSeconds: observation.observedSeconds, reliability: observation.reliability });
      if (result.accepted) learning.physicalObservations += 1;
    }
  }
  return { session, learning };
}

module.exports = {
  currentSessionProjection,
  advanceSession,
  changePresentationDepthV2: (args) => changePresentationAxis({ ...args, axis: "duration" }),
  changePresentationLanguageV2: (args) => changePresentationAxis({ ...args, axis: "language" }),
  recordContentEntryExperience,
  recordVenueTargetObservationV2,
  recordTransitionV2,
  routeToIntentV2,
  pauseSessionV2,
  resumeSessionV2,
  completeSessionV2,
};
