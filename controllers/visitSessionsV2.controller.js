const service = require("../services/visitSessionV2.service");
const plans = require("../services/sessionPlanV2.service");
const AppError = require("../utils/AppError");

async function start(req, res, next) {
  try {
    const payload = req.body || {};
    const hasVisit = Boolean(payload.visitId), hasPlan = Boolean(payload.generatedVisitPlanId);
    if (hasVisit === hasPlan) throw new AppError("Specificare esattamente una sorgente: visitId oppure generatedVisitPlanId", 400, [{ field: "source", code: "EXACTLY_ONE_SOURCE_REQUIRED" }]);
    const result = hasVisit
      ? await service.startVisitSessionV2({ userId: req.user._id, visitId: payload.visitId, payload })
      : await service.startGeneratedPlanSessionV2({ userId: req.user._id, planId: payload.generatedVisitPlanId, payload });
    res.status(201).json(result);
  } catch (error) { next(error); }
}
async function current(req, res, next) { try { res.json(await service.currentSessionProjection({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
async function currentPlan(req, res, next) { try { res.json(await plans.getCurrentSessionPlanV2({ sessionId: req.params.sessionId, userId: req.user._id, allowCompleted: true })); } catch (error) { next(error); } }
async function advance(req, res, next) { try { res.json(await service.advanceSession({ sessionId: req.params.sessionId, userId: req.user._id, direction: req.body?.direction })); } catch (error) { next(error); } }
async function presentationDepth(req, res, next) { try { res.json(await service.changePresentationDepthV2({ sessionId: req.params.sessionId, userId: req.user._id, direction: req.body?.direction === "down" ? "down" : "up" })); } catch (error) { next(error); } }
async function presentationLanguage(req, res, next) { try { res.json(await service.changePresentationLanguageV2({ sessionId: req.params.sessionId, userId: req.user._id, direction: req.body?.direction === "down" ? "down" : "up" })); } catch (error) { next(error); } }
async function contentExperience(req, res, next) { try { res.json(await service.recordContentEntryExperience({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function targetObservation(req, res, next) { try { res.json(await service.recordVenueTargetObservationV2({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function transition(req, res, next) { try { res.json(await service.recordTransitionV2({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function routeToIntent(req, res, next) { try { res.json(await service.routeToIntentV2({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function pause(req, res, next) { try { res.json(await service.pauseSessionV2({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
async function resume(req, res, next) { try { res.json(await service.resumeSessionV2({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
async function complete(req, res, next) { try { res.json(await service.completeSessionV2({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }

module.exports = { start, current, currentPlan, advance, presentationDepth, presentationLanguage, contentExperience, targetObservation, transition, routeToIntent, pause, resume, complete };
