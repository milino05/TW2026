const physicalVocabularyService = require("../services/physicalVocabulary.service");
const physicalVocabularyRevisionService = require("../services/physicalVocabularyRevision.service");

async function create(req, res, next) {
  try { res.status(201).json(await physicalVocabularyService.createPhysicalVocabulary({ payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function list(req, res, next) {
  try {
    res.status(200).json(await physicalVocabularyService.listPhysicalVocabularies({
      ownerType: req.query?.ownerType || null,
      ownerId: req.query?.ownerId || null,
      lifecycleStatus: req.query?.lifecycleStatus || "active",
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try { res.status(200).json(await physicalVocabularyService.getPhysicalVocabularyById({ physicalVocabularyId: req.params.physicalVocabularyId })); }
  catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    res.status(200).json(await physicalVocabularyService.updatePhysicalVocabulary({
      physicalVocabularyId: req.params.physicalVocabularyId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function fork(req, res, next) {
  try {
    res.status(201).json(await physicalVocabularyService.forkPhysicalVocabulary({
      physicalVocabularyId: req.params.physicalVocabularyId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function getPublishedRevision(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.getPublishedPhysicalVocabularyRevision({ physicalVocabularyId: req.params.physicalVocabularyId })); }
  catch (error) { next(error); }
}

async function getWorkingRevision(req, res, next) {
  try {
    res.status(200).json(await physicalVocabularyRevisionService.getWorkingPhysicalVocabularyRevision({
      physicalVocabularyId: req.params.physicalVocabularyId,
      actorUserId: req.user._id,
      create: req.query?.create === "true",
    }));
  } catch (error) { next(error); }
}

async function updateWorkingRevision(req, res, next) {
  try {
    res.status(200).json(await physicalVocabularyRevisionService.updatePhysicalVocabularyDraft({
      physicalVocabularyId: req.params.physicalVocabularyId,
      actorUserId: req.user._id,
      payload: req.body || {},
    }));
  } catch (error) { next(error); }
}

async function applyStarter(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.applyStarterToPhysicalVocabularyDraft({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function check(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.evaluatePhysicalVocabulary({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function requestReview(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.requestPhysicalVocabularyReview({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function withdrawReview(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.withdrawPhysicalVocabularyReview({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function requestChanges(req, res, next) {
  try {
    res.status(200).json(await physicalVocabularyRevisionService.requestPhysicalVocabularyChanges({
      physicalVocabularyId: req.params.physicalVocabularyId,
      actorUserId: req.user._id,
      message: req.body?.message,
    }));
  } catch (error) { next(error); }
}

async function publish(req, res, next) {
  try { res.status(200).json(await physicalVocabularyRevisionService.publishPhysicalVocabulary({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function trash(req, res, next) {
  try { res.status(200).json(await physicalVocabularyService.trashPhysicalVocabulary({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function restore(req, res, next) {
  try { res.status(200).json(await physicalVocabularyService.restorePhysicalVocabulary({ physicalVocabularyId: req.params.physicalVocabularyId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

module.exports = {
  create,
  list,
  get,
  update,
  fork,
  getPublishedRevision,
  getWorkingRevision,
  updateWorkingRevision,
  applyStarter,
  check,
  requestReview,
  withdrawReview,
  requestChanges,
  publish,
  trash,
  restore,
};
