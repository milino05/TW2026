const service = require("../services/visitSessionV2.service");
const actions = require("../services/actionDispatcherV2.service");

async function current(req, res, next) {
  try {
    res.json(await service.currentSessionProjection({ sessionId: req.params.sessionId, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function dispatchAction(req, res, next) {
  try {
    res.json(await actions.dispatchAction({
      sessionId: req.params.sessionId,
      userId: req.user._id,
      payload: req.body || {},
    }));
  } catch (error) { next(error); }
}

async function contentExperience(req, res, next) {
  try {
    res.json(await service.recordContentEntryExperience({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} }));
  } catch (error) { next(error); }
}

async function targetObservation(req, res, next) {
  try {
    res.json(await service.recordVenueTargetObservationV2({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} }));
  } catch (error) { next(error); }
}

async function transition(req, res, next) {
  try {
    res.json(await service.recordTransitionV2({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body || {} }));
  } catch (error) { next(error); }
}

module.exports = {
  current,
  dispatchAction,
  contentExperience,
  targetObservation,
  transition,
};
