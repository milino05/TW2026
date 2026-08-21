const editorialContextService = require("../services/editorialContext.service");
const { createGraphRevision } = require("../services/semanticGraphV2.service");
const { getEditorialContextGraph } = require("../services/editorialContextGraph.service");
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
async function createGraph(req, res, next) {
  try { res.status(201).json(await createGraphRevision({ editorialContextId: req.params.editorialContextId, payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function getGraph(req, res, next) {
  try { res.status(200).json(await getEditorialContextGraph({ editorialContextId: req.params.editorialContextId, view: req.query?.view || "working", actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function createRelease(req, res, next) {
  try { res.status(201).json(await editorialReleaseService.createEditorialRelease({ editorialContextId: req.params.editorialContextId, payload: req.body || {}, actorUserId: req.user._id })); }
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

module.exports = { create, list, get, update, createGraph, getGraph, createRelease, listReleases, getCurrentRelease };
