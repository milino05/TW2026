const service = require("../services/visitSession.service");
async function start(req, res, next) { try { res.status(201).json(await service.startSession({ userId: req.user._id, visitId: req.body.visitId, movementPacePreference: req.body.movementPacePreference })); } catch (error) { next(error); } }
async function transition(req, res, next) { try { res.json(await service.recordTransition({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body })); } catch (error) { next(error); } }
async function stop(req, res, next) { try { res.json(await service.recordStop({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body })); } catch (error) { next(error); } }
async function interaction(req, res, next) { try { res.json(await service.recordInteraction({ sessionId: req.params.sessionId, userId: req.user._id, payload: req.body })); } catch (error) { next(error); } }
async function pause(req, res, next) { try { res.json(await service.pauseSession({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
async function resume(req, res, next) { try { res.json(await service.resumeSession({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
async function complete(req, res, next) { try { res.json(await service.completeSession({ sessionId: req.params.sessionId, userId: req.user._id })); } catch (error) { next(error); } }
module.exports = { start, transition, stop, interaction, pause, resume, complete };
