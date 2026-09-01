const editorialContextService = require("../services/editorialContext.service");
const editorialContextEntryService = require("../services/editorialContextEntry.service");
const editorialContextReviewService = require("../services/editorialContextReview.service");
const { createGraphRevision } = require("../services/semanticGraphV2.service");
const { getEditorialContextGraph, projectGraph } = require("../services/editorialContextGraph.service");
const editorialReleaseService = require("../services/editorialRelease.service");

async function create(req, res, next) {
  try { res.status(201).json(await editorialContextService.createEditorialContext({ payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function list(req, res, next) {
  try { res.status(200).json(await editorialContextService.listEditorialContexts({ actorUserId: req.user._id, contentSpaceId: req.query?.contentSpaceId || null, namespaceId: req.query?.namespaceId || null })); }
  catch (error) { next(error); }
}
async function get(req, res, next) {
  try { res.status(200).json(await editorialContextService.getEditorialContext({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function update(req, res, next) {
  try { res.status(200).json(await editorialContextService.updateEditorialContext({ editorialContextId: req.params.editorialContextId, payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function listEntries(req, res, next) {
  try { res.status(200).json(await editorialContextEntryService.listEditorialContextEntries({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id, page: req.query?.page, limit: req.query?.limit })); }
  catch (error) { next(error); }
}
async function addEntry(req, res, next) {
  try { res.status(201).json(await editorialContextEntryService.addEditorialContextEntry({ editorialContextId: req.params.editorialContextId, itemEditionId: req.body?.itemEditionId, curationSignals: req.body?.curationSignals || [], actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function updateEntry(req, res, next) {
  try { res.status(200).json(await editorialContextEntryService.updateEditorialContextEntry({ editorialContextId: req.params.editorialContextId, entryId: req.params.entryId, curationSignals: req.body?.curationSignals, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function removeEntry(req, res, next) {
  try { res.status(200).json(await editorialContextEntryService.removeEditorialContextEntry({ editorialContextId: req.params.editorialContextId, entryId: req.params.entryId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function createGraph(req, res, next) {
  try {
    const graph = await createGraphRevision({ editorialContextId: req.params.editorialContextId, payload: req.body || {}, actorUserId: req.user._id });
    res.status(201).json(projectGraph(graph));
  } catch (error) { next(error); }
}
async function getGraph(req, res, next) {
  try { res.status(200).json(await getEditorialContextGraph({ editorialContextId: req.params.editorialContextId, view: req.query?.view || "working", actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function checkReadiness(req, res, next) {
  try { res.status(200).json(await editorialContextReviewService.checkEditorialContextReadiness({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function requestReview(req, res, next) {
  try { res.status(201).json(await editorialContextReviewService.requestEditorialContextReview({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function withdrawReview(req, res, next) {
  try { res.status(200).json(await editorialContextReviewService.withdrawEditorialContextReview({ editorialContextId: req.params.editorialContextId, revisionId: req.params.revisionId || null, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function requestChanges(req, res, next) {
  try { res.status(200).json(await editorialContextReviewService.requestEditorialContextChanges({ editorialContextId: req.params.editorialContextId, revisionId: req.params.revisionId, message: req.body?.message, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function approveReview(req, res, next) {
  try { res.status(200).json(await editorialContextReviewService.approveEditorialContextReview({ editorialContextId: req.params.editorialContextId, revisionId: req.params.revisionId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function listRevisions(req, res, next) {
  try { res.status(200).json(await editorialContextReviewService.listEditorialContextRevisions({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function createRelease(req, res, next) {
  try { res.status(201).json(await editorialReleaseService.createEditorialRelease({ editorialContextId: req.params.editorialContextId, editorialContextRevisionId: req.body?.editorialContextRevisionId || null, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function listReleases(req, res, next) {
  try { res.status(200).json(await editorialReleaseService.listEditorialReleases({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function getCurrentRelease(req, res, next) {
  try { res.status(200).json(await editorialReleaseService.getCurrentEditorialRelease({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

module.exports = {
  create, list, get, update,
  listEntries, addEntry, updateEntry, removeEntry,
  createGraph, getGraph,
  checkReadiness, requestReview, withdrawReview, requestChanges, approveReview, listRevisions,
  createRelease, listReleases, getCurrentRelease,
};
