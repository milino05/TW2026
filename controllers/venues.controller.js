const venueService = require("../services/venue.service");
const venueTargetService = require("../services/venueTarget.service");
const venueReleaseService = require("../services/venueRelease.service");
const venuePhysicalOnboardingService = require("../services/venuePhysicalOnboarding.service");
const venueLayoutCommandService = require("../services/venueLayoutCommand.service");
const venueTargetBindingCommandService = require("../services/venueTargetBindingCommand.service");
const venueTargetConfigurationCommandService = require("../services/venueTargetConfigurationCommand.service");
const venuePhysicalAssetUsageService = require("../services/venuePhysicalAssetUsage.service");
const venueFloorPlanUploadService = require("../services/venueFloorPlanUpload.service");
const venueRecognitionMediaUploadService = require("../services/venueRecognitionMediaUpload.service");
const AppError = require("../utils/AppError");

async function list(req, res, next) { try { res.status(200).json(await venueService.listVenues({ ownerOrganizationId: req.query?.ownerOrganizationId || null })); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.status(200).json(await venueService.getVenue({ venueId: req.params.venueId })); } catch (error) { next(error); } }
async function create(req, res, next) { try { res.status(201).json(await venueService.createVenue({ payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function update(req, res, next) { try { res.status(200).json(await venueService.updateVenue({ venueId: req.params.venueId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }

async function listTargets(req, res, next) { try { res.status(200).json(await venueTargetService.listVenueTargets({ venueId: req.params.venueId, view: req.query?.view || "published", actorUserId: req.user?._id || null })); } catch (error) { next(error); } }
async function createTarget(req, res, next) { try { res.status(201).json(await venueTargetService.createVenueTarget({ venueId: req.params.venueId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function updateTarget(req, res, next) { try { res.status(200).json(await venueTargetService.updateVenueTarget({ venueId: req.params.venueId, venueTargetId: req.params.venueTargetId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function trashTarget(req, res, next) { try { res.status(200).json(await venueTargetService.trashVenueTarget({ venueId: req.params.venueId, venueTargetId: req.params.venueTargetId, actorUserId: req.user._id })); } catch (error) { next(error); } }

async function getPhysicalState(req, res, next) { try { res.status(200).json(await venueReleaseService.getVenuePhysicalState({ venueId: req.params.venueId, view: req.query?.view || "published", actorUserId: req.user?._id || null })); } catch (error) { next(error); } }
async function getPhysicalOnboarding(req, res, next) { try { res.status(200).json(await venuePhysicalOnboardingService.getVenuePhysicalOnboarding({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function initializePhysicalOnboarding(req, res, next) { try { res.status(200).json(await venuePhysicalOnboardingService.initializeVenuePhysicalConfiguration({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function ensureWorkingRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.ensureWorkingVenueRelease({ venueId: req.params.venueId, physicalVocabularyRevisionId: req.body?.physicalVocabularyRevisionId || null, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function checkRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.checkVenueReleaseConsistency({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function submitReleaseReview(req, res, next) { try { res.status(200).json(await venueReleaseService.submitVenueReleaseReview({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function withdrawReleaseReview(req, res, next) { try { res.status(200).json(await venueReleaseService.withdrawVenueReleaseReview({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestReleaseChanges(req, res, next) { try { res.status(200).json(await venueReleaseService.requestVenueReleaseChanges({ venueId: req.params.venueId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publishRelease(req, res, next) { try { res.status(200).json(await venueReleaseService.publishVenueRelease({ venueId: req.params.venueId, actorUserId: req.user._id })); } catch (error) { next(error); } }

async function detachTargetFromWorkingConfiguration(req, res, next) {
  try {
    const result = await venueTargetConfigurationCommandService.detachVenueTargetFromWorkingConfiguration({
      venueId: req.params.venueId,
      venueTargetId: req.params.venueTargetId,
      actorUserId: req.user._id,
    });
    await Promise.all((result.recognitionMediaUrls || []).map((url) =>
      venuePhysicalAssetUsageService.removeVenueRecognitionMediaIfUnreferenced(url).catch(() => false)
    ));
    res.status(200).json(result);
  } catch (error) { next(error); }
}
async function setTargetAvailability(req, res, next) {
  try {
    res.status(200).json(await venueTargetBindingCommandService.setAvailability({
      venueId: req.params.venueId,
      venueTargetId: req.params.venueTargetId,
      actorUserId: req.user._id,
      payload: req.body || {},
    }));
  } catch (error) { next(error); }
}
async function uploadTargetRecognitionMedia(req, res, next) {
  let stored = null;
  try {
    await venueReleaseService.ensureWorkingVenueRelease({ venueId: req.params.venueId, actorUserId: req.user._id });
    stored = await venueRecognitionMediaUploadService.storeVenueRecognitionMedia({ payload: req.body || {} });
    const result = await venueTargetBindingCommandService.addRecognitionMedia({
      venueId: req.params.venueId,
      venueTargetId: req.params.venueTargetId,
      actorUserId: req.user._id,
      payload: stored,
    });
    res.status(201).json(result);
  } catch (error) {
    if (stored?.url) await venueRecognitionMediaUploadService.removeVenueRecognitionMedia(stored.url).catch(() => {});
    next(error);
  }
}
async function removeTargetRecognitionMedia(req, res, next) {
  try {
    const result = await venueTargetBindingCommandService.removeRecognitionMedia({
      venueId: req.params.venueId,
      venueTargetId: req.params.venueTargetId,
      mediaId: req.params.mediaId,
      actorUserId: req.user._id,
    });
    const removedUrl = result?.result?.url || null;
    if (removedUrl) await venuePhysicalAssetUsageService.removeVenueRecognitionMediaIfUnreferenced(removedUrl).catch(() => {});
    res.status(200).json(result);
  } catch (error) { next(error); }
}

async function addLayoutFloor(req, res, next) { try { res.status(201).json(await venueLayoutCommandService.addFloor({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function updateLayoutFloor(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.updateFloor({ venueId: req.params.venueId, floorId: req.params.floorId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function uploadLayoutFloorPlan(req, res, next) {
  let stored = null;
  try {
    const ensured = await venueReleaseService.ensureWorkingVenueRelease({ venueId: req.params.venueId, actorUserId: req.user._id });
    const floor = ensured.layout.floors.id(req.params.floorId);
    if (!floor) throw new AppError("Piano non trovato", 404, [{ field: "floorId", code: "FLOOR_NOT_FOUND" }]);
    const previousUrl = floor.mapAsset?.url || null;
    stored = await venueFloorPlanUploadService.storeVenueFloorPlan({ payload: req.body || {} });
    const result = await venueLayoutCommandService.updateFloor({
      venueId: req.params.venueId,
      floorId: req.params.floorId,
      actorUserId: req.user._id,
      payload: { mapAsset: stored },
    });
    if (previousUrl && previousUrl !== stored.url) {
      await venuePhysicalAssetUsageService.removeVenueFloorPlanIfUnreferenced(previousUrl).catch(() => {});
    }
    res.status(200).json(result);
  } catch (error) {
    if (stored?.url) await venueFloorPlanUploadService.removeVenueFloorPlan(stored.url).catch(() => {});
    next(error);
  }
}
async function calibrateLayoutFloor(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.calibrateFloor({ venueId: req.params.venueId, floorId: req.params.floorId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function removeLayoutFloor(req, res, next) {
  try {
    const ensured = await venueReleaseService.ensureWorkingVenueRelease({ venueId: req.params.venueId, actorUserId: req.user._id });
    const floor = ensured.layout.floors.id(req.params.floorId);
    if (!floor) throw new AppError("Piano non trovato", 404, [{ field: "floorId", code: "FLOOR_NOT_FOUND" }]);
    const previousUrl = floor.mapAsset?.url || null;
    const result = await venueLayoutCommandService.removeFloor({ venueId: req.params.venueId, floorId: req.params.floorId, actorUserId: req.user._id });
    if (previousUrl) await venuePhysicalAssetUsageService.removeVenueFloorPlanIfUnreferenced(previousUrl).catch(() => {});
    res.status(200).json(result);
  } catch (error) { next(error); }
}
async function createLayoutPlace(req, res, next) { try { res.status(201).json(await venueLayoutCommandService.createPlace({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function moveLayoutPlace(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.movePlace({ venueId: req.params.venueId, placeId: req.params.placeId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function updateLayoutPlace(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.updatePlace({ venueId: req.params.venueId, placeId: req.params.placeId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function setLayoutPlaceAttribute(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.setPlaceAttribute({ venueId: req.params.venueId, placeId: req.params.placeId, definitionId: req.params.definitionId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function removeLayoutPlace(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.removePlace({ venueId: req.params.venueId, placeId: req.params.placeId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function createLayoutConnection(req, res, next) { try { res.status(201).json(await venueLayoutCommandService.createConnection({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function updateLayoutConnection(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.updateConnection({ venueId: req.params.venueId, connectionId: req.params.connectionId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function setLayoutConnectionAttribute(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.setConnectionAttribute({ venueId: req.params.venueId, connectionId: req.params.connectionId, definitionId: req.params.definitionId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function removeLayoutConnection(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.removeConnection({ venueId: req.params.venueId, connectionId: req.params.connectionId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function setLayoutTargetPlacement(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.setVenueTargetPlacement({ venueId: req.params.venueId, venueTargetId: req.params.venueTargetId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }
async function setPreVisitInformation(req, res, next) { try { res.status(200).json(await venueLayoutCommandService.setPreVisitInformation({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} })); } catch (error) { next(error); } }

module.exports = {
  list, get, create, update,
  listTargets, createTarget, updateTarget, trashTarget,
  getPhysicalState, getPhysicalOnboarding, initializePhysicalOnboarding,
  ensureWorkingRelease, checkRelease,
  submitReleaseReview, withdrawReleaseReview, requestReleaseChanges, publishRelease,
  detachTargetFromWorkingConfiguration, setTargetAvailability, uploadTargetRecognitionMedia, removeTargetRecognitionMedia,
  addLayoutFloor, updateLayoutFloor, uploadLayoutFloorPlan, calibrateLayoutFloor, removeLayoutFloor,
  createLayoutPlace, moveLayoutPlace, updateLayoutPlace, setLayoutPlaceAttribute, removeLayoutPlace,
  createLayoutConnection, updateLayoutConnection, setLayoutConnectionAttribute, removeLayoutConnection,
  setLayoutTargetPlacement, setPreVisitInformation,
};
