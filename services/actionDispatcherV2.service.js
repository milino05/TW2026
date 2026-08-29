const VisitSessionV2 = require("../models/visitSessionV2.model");
const AppError = require("../utils/AppError");
const {
  deriveRuntimeActions,
  currentSessionProjection,
  advanceSession,
  changePresentationDepthV2,
  changePresentationComplexityV2,
  openSemanticPresentationV2,
  returnFromSemanticPresentationV2,
  routeToPhysicalFeatureV2,
  pauseSessionV2,
  resumeSessionV2,
  completeSessionV2,
} = require("./visitSessionV2.service");
const {
  projectNavigationRoute,
  projectNextRouteObstacles,
} = require("./navigationProjectionV2.service");

const INTERACTION_CHANNELS = new Set(["button", "controlled_voice", "natural_language", "system"]);

function normalizeExpectedRuntimeVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError("expectedRuntimeVersion e obbligatoria", 400, [{ field: "expectedRuntimeVersion", code: "REQUIRED" }]);
  }
  return version;
}

function normalizeInteractionChannel(value) {
  const channel = value == null ? "button" : String(value).trim();
  if (!INTERACTION_CHANNELS.has(channel)) {
    throw new AppError("interactionChannel non valido", 400, [{ field: "interactionChannel", code: "INVALID_INTERACTION_CHANNEL" }]);
  }
  return channel;
}

function errorCode(error) { return error?.details?.[0]?.code || error?.code || "ACTION_FAILED"; }

function withCurrentSemanticContext(descriptor, session) {
  if (!descriptor || !session?.semanticPresentation) return descriptor;
  return {
    ...descriptor,
    context: {
      ...(descriptor.context || {}),
      semanticSubjectId: descriptor.context?.semanticSubjectId || session.semanticPresentation.subjectId,
      semanticItemEditionId: descriptor.context?.semanticItemEditionId || session.semanticPresentation.itemEditionId,
    },
  };
}

function interactionEvent({ userId, descriptor, actionId, interactionChannel, status, code = null }) {
  return {
    category: "action",
    actorUserId: userId,
    actionId: descriptor?.actionId || actionId || null,
    actionType: descriptor?.type || null,
    actionFamily: descriptor?.family || null,
    interactionChannel,
    context: descriptor?.context || {},
    result: { status, code },
    metadata: null,
    at: new Date(),
  };
}

async function recordRejectedUnavailable({ sessionId, userId, actionId, interactionChannel }) {
  await VisitSessionV2.updateOne(
    { _id: sessionId, userId },
    { $push: { interactionEvents: interactionEvent({ userId, actionId, interactionChannel, status: "rejected", code: "ACTION_NOT_AVAILABLE" }) } },
  ).catch(() => {});
}

async function claimRuntimeVersion({ sessionId, userId, expectedRuntimeVersion }) {
  const claimed = await VisitSessionV2.findOneAndUpdate(
    { _id: sessionId, userId, runtimeVersion: expectedRuntimeVersion },
    { $inc: { runtimeVersion: 1 } },
    { new: true },
  ).select("_id runtimeVersion").lean();
  if (claimed) return claimed.runtimeVersion;
  const current = await VisitSessionV2.findOne({ _id: sessionId, userId }).select("runtimeVersion").lean();
  if (!current) throw new AppError("VisitSession non disponibile", 404);
  throw new AppError("La Session e stata modificata", 409, [{ code: "RUNTIME_VERSION_CONFLICT", context: { currentRuntimeVersion: current.runtimeVersion } }]);
}

async function executeDescriptor({ sessionId, userId, descriptor }) {
  switch (descriptor.type) {
    case "PROGRESS_NEXT": await advanceSession({ sessionId, userId, direction: "next" }); return null;
    case "PROGRESS_PREVIOUS": await advanceSession({ sessionId, userId, direction: "previous" }); return null;
    case "PRESENTATION_DEPTH_INCREASE": await changePresentationDepthV2({ sessionId, userId, direction: "up" }); return null;
    case "PRESENTATION_DEPTH_DECREASE": await changePresentationDepthV2({ sessionId, userId, direction: "down" }); return null;
    case "PRESENTATION_COMPLEXITY_INCREASE": await changePresentationComplexityV2({ sessionId, userId, direction: "up" }); return null;
    case "PRESENTATION_COMPLEXITY_DECREASE": await changePresentationComplexityV2({ sessionId, userId, direction: "down" }); return null;
    case "EXPLORE_SEMANTIC_RELATION": {
      const resolution = descriptor.serverInput?.resolution;
      if (resolution?.status === "resolved" && resolution.selected) {
        await openSemanticPresentationV2({ sessionId, userId, serverInput: resolution.selected, sourceActionId: descriptor.actionId });
        return { type: "semantic_presentation" };
      }
      if (resolution?.status === "ambiguous" && Array.isArray(resolution.choices) && resolution.choices.length) {
        return { type: "semantic_choices", choices: resolution.choices };
      }
      throw new AppError("La relazione semantica non è risolvibile nello scope corrente", 409, [{ code: "SEMANTIC_RELATION_UNRESOLVABLE" }]);
    }
    case "EXPLORE_SEMANTIC_CONTENT":
      await openSemanticPresentationV2({ sessionId, userId, serverInput: descriptor.serverInput, sourceActionId: descriptor.actionId });
      return { type: "semantic_presentation" };
    case "SEMANTIC_RETURN":
      await returnFromSemanticPresentationV2({ sessionId, userId });
      return { type: "semantic_return" };
    case "PAUSE": await pauseSessionV2({ sessionId, userId }); return null;
    case "RESUME": await resumeSessionV2({ sessionId, userId }); return null;
    case "COMPLETE": {
      const completed = await completeSessionV2({ sessionId, userId });
      return { type: "completion", learning: completed.learning };
    }
    case "NAVIGATE_TO_PHYSICAL_FEATURE": {
      const routeResult = await routeToPhysicalFeatureV2({ sessionId, userId, physicalFeatureRef: descriptor.serverInput?.physicalFeatureRef });
      return {
        type: "navigation_requested",
        navigation: await projectNavigationRoute({ sessionId, userId, routeResult }),
      };
    }
    case "CHECK_ROUTE_OBSTACLES":
      return {
        type: "obstacle_check",
        obstacleCheck: await projectNextRouteObstacles({ sessionId, userId }),
      };
    default:
      throw new AppError("Action non supportata dal dispatcher", 409, [{ code: "ACTION_NOT_SUPPORTED" }]);
  }
}

function appendSemanticChoices(runtime, effect) {
  if (effect?.type !== "semantic_choices" || !Array.isArray(effect.choices) || !effect.choices.length) return runtime;
  const seen = new Set((runtime.availableActions || []).map((action) => String(action.actionId)));
  const choices = effect.choices
    .filter((choice) => choice?.actionId && !seen.has(String(choice.actionId)))
    .map((choice) => ({
      ...choice,
      semanticChoice: true,
      semanticChoiceRequestVersion: runtime.session?.runtimeVersion,
    }));
  return choices.length ? { ...runtime, availableActions: [...(runtime.availableActions || []), ...choices] } : runtime;
}

async function dispatchAction({ sessionId, userId, payload = {} }) {
  const actionId = String(payload.actionId || "").trim();
  if (!actionId) throw new AppError("actionId e obbligatorio", 400, [{ field: "actionId", code: "REQUIRED" }]);
  const expectedRuntimeVersion = normalizeExpectedRuntimeVersion(payload.expectedRuntimeVersion);
  const interactionChannel = normalizeInteractionChannel(payload.interactionChannel);

  const derived = await deriveRuntimeActions({ sessionId, userId });
  const rawDescriptor = derived.actions.find((entry) => entry.actionId === actionId) || null;
  if (!rawDescriptor) {
    await recordRejectedUnavailable({ sessionId, userId, actionId, interactionChannel });
    throw new AppError("Action non disponibile nello stato corrente", 409, [{ code: "ACTION_NOT_AVAILABLE" }]);
  }
  const descriptor = withCurrentSemanticContext(rawDescriptor, derived.session);
  if (derived.session.runtimeVersion !== expectedRuntimeVersion) {
    throw new AppError("La Session e stata modificata", 409, [{ code: "RUNTIME_VERSION_CONFLICT", context: { currentRuntimeVersion: derived.session.runtimeVersion } }]);
  }

  await claimRuntimeVersion({ sessionId, userId, expectedRuntimeVersion });
  let effect = null;
  try {
    effect = await executeDescriptor({ sessionId, userId, descriptor });
  } catch (error) {
    await VisitSessionV2.updateOne(
      { _id: sessionId, userId },
      { $push: { interactionEvents: interactionEvent({ userId, descriptor, interactionChannel, status: "rejected", code: errorCode(error) }) } },
    ).catch(() => {});
    throw error;
  }

  await VisitSessionV2.updateOne(
    { _id: sessionId, userId },
    { $push: { interactionEvents: interactionEvent({ userId, descriptor, interactionChannel, status: "applied" }) } },
  );
  const runtime = appendSemanticChoices(await currentSessionProjection({ sessionId, userId }), effect);
  return {
    action: { actionId: descriptor.actionId, type: descriptor.type, family: descriptor.family },
    runtime,
    effect,
  };
}

module.exports = { dispatchAction, normalizeExpectedRuntimeVersion, normalizeInteractionChannel };