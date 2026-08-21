const namespaceService = require("../services/namespace.service");
const namespaceRevisionService = require("../services/namespaceRevision.service");

async function create(req, res, next) {
  try { res.status(201).json(await namespaceService.createNamespace({ payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function list(req, res, next) {
  try {
    res.status(200).json(await namespaceService.listNamespaces({
      ownerType: req.query?.ownerType || null,
      ownerId: req.query?.ownerId || null,
    }));
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try { res.status(200).json(await namespaceService.getNamespaceById({ namespaceId: req.params.namespaceId })); }
  catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    res.status(200).json(await namespaceService.updateNamespace({
      namespaceId: req.params.namespaceId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function fork(req, res, next) {
  try {
    res.status(201).json(await namespaceService.forkNamespace({
      namespaceId: req.params.namespaceId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function getPublishedRevision(req, res, next) {
  try { res.status(200).json(await namespaceRevisionService.getPublishedNamespaceRevision({ namespaceId: req.params.namespaceId })); }
  catch (error) { next(error); }
}

async function getWorkingRevision(req, res, next) {
  try {
    res.status(200).json(await namespaceRevisionService.getWorkingNamespaceRevision({
      namespaceId: req.params.namespaceId,
      actorUserId: req.user._id,
      create: req.query?.create === "true",
    }));
  } catch (error) { next(error); }
}

async function updateWorkingRevision(req, res, next) {
  try {
    res.status(200).json(await namespaceRevisionService.updateNamespaceDraft({
      namespaceId: req.params.namespaceId,
      actorUserId: req.user._id,
      payload: req.body || {},
    }));
  } catch (error) { next(error); }
}

async function check(req, res, next) {
  try { res.status(200).json(await namespaceRevisionService.evaluateNamespace({ namespaceId: req.params.namespaceId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function requestReview(req, res, next) {
  try { res.status(200).json(await namespaceRevisionService.requestNamespaceReview({ namespaceId: req.params.namespaceId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function withdrawReview(req, res, next) {
  try { res.status(200).json(await namespaceRevisionService.withdrawNamespaceReview({ namespaceId: req.params.namespaceId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

async function requestChanges(req, res, next) {
  try {
    res.status(200).json(await namespaceRevisionService.requestNamespaceChanges({
      namespaceId: req.params.namespaceId,
      actorUserId: req.user._id,
      message: req.body?.message,
    }));
  } catch (error) { next(error); }
}

async function publish(req, res, next) {
  try { res.status(200).json(await namespaceRevisionService.publishNamespace({ namespaceId: req.params.namespaceId, actorUserId: req.user._id })); }
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
  check,
  requestReview,
  withdrawReview,
  requestChanges,
  publish,
};
