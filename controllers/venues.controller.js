const venueService = require("../services/venue.service");
const venueTargetService = require("../services/venueTarget.service");
const venueReleaseService = require("../services/venueRelease.service");

async function list(req, res, next) { try { res.status(200).json(await venueService.listVenues({ ownerOrganizationId: req.query?.ownerOrganizationId || null })); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.status(200).json(await venueService.getVenue({ venueId: req.params.venueId })); } catch (error) { next(error); } }
async function create(req, res, next) { try { res.status(201).json(await venueService.createVenue({ payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function update(req, res, next) { try { res.status(200).json(await venueService.updateVenue({ venueId: req.params.venueId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }

async function listTargets(req, res, next) { try { res.status(200).json(await venueTargetService.listVenueTargets({ venueId: req.params.venueId, view: req.query?.view || "published", actorUserId: req.user?._id || null })); } catch (error) { next(error); } }
async function createTarget(req, res, next) { try { res.status(201).json(await venueTargetService.createVenueTarget({ venueId: req.params.venueId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function updateTarget(req, res, next) { try { res.status(200).json(await venueTargetService.updateVenueTarget({ venueId: req.params.venueId, venueTargetId: req.params.venueTargetId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function trashTarget(req, res, next) { try { res.status(200).json(await venueTargetService.trashVenueTarget({ venueId: req.params.venueId, venueTargetId: req.params.venueTargetId, actorUserId: req.user._id })); } catch (error) { next(error); } }

async function getPhysicalState(req, res, next) { try { res.status(200).json(await venueReleaseService.getVenuePhysicalState({ venueId: req.params.venueId, view: req.query?.view || "published", actorUserId: req.user?._id || null })); } catch (error) { next(error); } }
async function ensureWorkingRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.ensureWorkingVenueRelease({ venueId: req.params.venueId, physicalVocabularyRevisionId: req.body?.physicalVocabularyRevisionId || null, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function updateWorkingRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.updateWorkingVenueRelease({ venueId: req.params.venueId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function checkRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.checkVenueReleaseConsistency({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function submitReleaseReview(req, res, next) { try { res.status(200).json(await venueReleaseService.submitVenueReleaseReview({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function withdrawReleaseReview(req, res, next) { try { res.status(200).json(await venueReleaseService.withdrawVenueReleaseReview({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestReleaseChanges(req, res, next) { try { res.status(200).json(await venueReleaseService.requestVenueReleaseChanges({ venueId: req.params.venueId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publishRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.publishVenueRelease({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }

module.exports = { list, get, create, update, listTargets, createTarget, updateTarget, trashTarget, getPhysicalState, ensureWorkingRelease, updateWorkingRelease, checkRelease, submitReleaseReview, withdrawReleaseReview, requestReleaseChanges, publishRelease };
