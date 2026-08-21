const editorialContextService = require("../services/editorialContext.service");

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

module.exports = { create, list, get, update };
