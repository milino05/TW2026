const generator = require("../services/visitGenerator.service");
const replan = require("../services/replan.service");
const sessions = require("../services/visitSession.service");

async function generate(req, res, next) { try { res.status(201).json(await generator.generateVisitPlan({ userId: req.user._id, museumId: req.params.museumId, request: req.body || {} })); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.status(200).json(await generator.getGeneratedPlan({ planId: req.params.planId, userId: req.user._id })); } catch (error) { next(error); } }
async function accept(req, res, next) { try { res.status(200).json(await generator.acceptGeneratedPlan({ planId: req.params.planId, userId: req.user._id })); } catch (error) { next(error); } }
async function start(req, res, next) { try { res.status(201).json(await sessions.startGeneratedPlanSession({ userId: req.user._id, planId: req.params.planId })); } catch (error) { next(error); } }
async function proposeReplan(req, res, next) { try { res.status(201).json(await replan.proposeReplan({ userId: req.user._id, planId: req.params.planId, sessionId: req.body?.sessionId, currentStopIndex: req.body?.currentStopIndex, currentPlaceId: req.body?.currentPlaceId, reason: req.body?.reason })); } catch (error) { next(error); } }
async function acceptReplan(req, res, next) { try { res.status(200).json(await replan.resolveReplanProposal({ userId: req.user._id, proposalId: req.params.proposalId, accept: true })); } catch (error) { next(error); } }
async function rejectReplan(req, res, next) { try { res.status(200).json(await replan.resolveReplanProposal({ userId: req.user._id, proposalId: req.params.proposalId, accept: false })); } catch (error) { next(error); } }

module.exports = { generate, get, accept, start, proposeReplan, acceptReplan, rejectReplan };
