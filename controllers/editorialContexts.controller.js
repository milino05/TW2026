const editorialContextService = require("../services/editorialContext.service");
const editorialContextEntryService = require("../services/editorialContextEntry.service");
const editorialContextReviewService = require("../services/editorialContextReview.service");
const editorialGraphCommandService = require("../services/editorialGraphCommand.service");
const { getEditorialContextGraph, getEditorialContextGraphNeighborhood, projectGraph, searchEditorialGraphSubjectCandidates } = require("../services/editorialContextGraph.service");
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
  try { res.status(200).json(await editorialContextEntryService.listEditorialContextEntries({ editorialContextId: req.params.editorialContextId, actorUserId: req.user._id, q: req.query?.q || "", page: req.query?.page, limit: req.query?.limit })); }
  catch (error) { next(error); }
}
async function addEntry(req, res, next) {
  try { res.status(201).json(await editorialContextEntryService.addEditorialContextEntry({ editorialContextId: req.params.editorialContextId, itemId: req.body?.itemId, curationSignals: req.body?.curationSignals || [], actorUserId: req.user._id })); }
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
async function getGraph(req, res, next) {
  try { res.status(200).json(await getEditorialContextGraph({ editorialContextId: req.params.editorialContextId, view: req.query?.view || "working", actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function getGraphNeighborhood(req, res, next) {
  try {
    res.status(200).json(await getEditorialContextGraphNeighborhood({
      editorialContextId: req.params.editorialContextId,
      view: req.query?.view || "working",
      focusSubjectId: req.query?.focusSubjectId || null,
      limit: req.query?.limit,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}
async function searchGraphSubjectCandidates(req, res, next) {
  try {
    res.status(200).json(await searchEditorialGraphSubjectCandidates({
      editorialContextId: req.params.editorialContextId,
      actorUserId: req.user._id,
      scope: req.query?.scope || "collection",
      q: req.query?.q || "",
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}
async function addGraphSubject(req, res, next) {
  try { res.status(201).json(projectGraph(await editorialGraphCommandService.addEditorialGraphSubject({ editorialContextId: req.params.editorialContextId, subjectId: req.params.subjectId, actorUserId: req.user._id }))); }
  catch (error) { next(error); }
}
async function removeGraphSubject(req, res, next) {
  try { res.status(200).json(projectGraph(await editorialGraphCommandService.removeEditorialGraphSubject({ editorialContextId: req.params.editorialContextId, subjectId: req.params.subjectId, actorUserId: req.user._id }))); }
  catch (error) { next(error); }
}
async function addGraphEdge(req, res, next) {
  try { res.status(201).json(projectGraph(await editorialGraphCommandService.addEditorialGraphEdge({ editorialContextId: req.params.editorialContextId, payload: req.body || {}, actorUserId: req.user._id }))); }
  catch (error) { next(error); }
}
async function updateGraphEdge(req, res, next) {
  try { res.status(200).json(projectGraph(await editorialGraphCommandService.updateEditorialGraphEdge({ editorialContextId: req.params.editorialContextId, edgeId: req.params.edgeId, payload: req.body || {}, actorUserId: req.user._id }))); }
  catch (error) { next(error); }
}
async function removeGraphEdge(req, res, next) {
  try { res.status(200).json(projectGraph(await editorialGraphCommandService.removeEditorialGraphEdge({ editorialContextId: req.params.editorialContextId, edgeId: req.params.edgeId, actorUserId: req.user._id }))); }
  catch (error) { next(error); }
}
async function setGraphSubjectClasses(req, res, next) {
  try { res.status(200).json(projectGraph(await editorialGraphCommandService.setEditorialGraphSubjectClasses({ editorialContextId: req.params.editorialContextId, subjectId: req.params.subjectId, subjectClassDefinitionIds: req.body?.subjectClassDefinitionIds || [], actorUserId: req.user._id }))); }
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
  getGraph, getGraphNeighborhood, searchGraphSubjectCandidates, addGraphSubject, removeGraphSubject, addGraphEdge, updateGraphEdge, removeGraphEdge, setGraphSubjectClasses,
  checkReadiness, requestReview, withdrawReview, requestChanges, approveReview, listRevisions,
  createRelease, listReleases, getCurrentRelease,
};
