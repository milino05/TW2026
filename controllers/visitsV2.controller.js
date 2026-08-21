const visitService = require("../services/visitV2.service");
const publicationService = require("../services/visitV2Publication.service");

async function list(req, res, next) { try { res.status(200).json(await visitService.listManageableVisitsV2({ actorUserId: req.user._id })); } catch (error) { next(error); } }
async function create(req, res, next) { try { res.status(201).json(await visitService.createVisitV2({ payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.status(200).json(await visitService.getVisitV2({ visitId: req.params.visitId, actorUserId: req.user._id, view: req.query?.view || "working" })); } catch (error) { next(error); } }
async function update(req, res, next) { try { res.status(200).json(await visitService.updateVisitV2({ visitId: req.params.visitId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function copy(req, res, next) { try { res.status(201).json(await visitService.copyVisitV2({ sourceVisitId: req.params.visitId, sourceRevisionId: req.body?.sourceRevisionId || null, ownerType: req.body?.ownerType, ownerId: req.body?.ownerId, title: req.body?.title || null, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function trash(req, res, next) { try { res.status(200).json(await visitService.trashVisitV2({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function restore(req, res, next) { try { res.status(200).json(await visitService.restoreVisitV2({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function check(req, res, next) { try { res.status(200).json(await publicationService.evaluateVisitV2Consistency({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestReview(req, res, next) { try { res.status(200).json(await publicationService.requestVisitV2Review({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function withdrawReview(req, res, next) { try { res.status(200).json(await publicationService.withdrawVisitV2Review({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestChanges(req, res, next) { try { res.status(200).json(await publicationService.requestVisitV2Changes({ visitId: req.params.visitId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publish(req, res, next) { try { res.status(200).json(await publicationService.publishVisitV2({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); } }

module.exports = { list, create, get, update, copy, trash, restore, check, requestReview, withdrawReview, requestChanges, publish };
