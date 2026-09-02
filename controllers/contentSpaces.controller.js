const contentSpaceService = require("../services/contentSpace.service");

async function create(req, res, next) {
  try { res.status(201).json(await contentSpaceService.createContentSpace({ payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function list(req, res, next) {
  try { res.status(200).json(await contentSpaceService.listContentSpaces({ actorUserId: req.user._id, ownerType: req.query?.ownerType || null, ownerId: req.query?.ownerId || null })); }
  catch (error) { next(error); }
}
async function get(req, res, next) {
  try { res.status(200).json(await contentSpaceService.getContentSpace({ contentSpaceId: req.params.contentSpaceId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function update(req, res, next) {
  try { res.status(200).json(await contentSpaceService.updateContentSpace({ contentSpaceId: req.params.contentSpaceId, payload: req.body || {}, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function remove(req, res, next) {
  try { res.status(200).json(await contentSpaceService.trashContentSpace({ contentSpaceId: req.params.contentSpaceId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function listItems(req, res, next) {
  try {
    res.status(200).json(await contentSpaceService.listItemMemberships({
      contentSpaceId: req.params.contentSpaceId,
      actorUserId: req.user._id,
      page: req.query?.page,
      limit: req.query?.limit,
      q: req.query?.q || "",
    }));
  }
  catch (error) { next(error); }
}
async function addItem(req, res, next) {
  try { res.status(201).json(await contentSpaceService.addItemMembership({ contentSpaceId: req.params.contentSpaceId, itemId: req.params.itemId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function removeItem(req, res, next) {
  try { res.status(200).json(await contentSpaceService.removeItemMembership({ contentSpaceId: req.params.contentSpaceId, itemId: req.params.itemId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}
async function moveItem(req, res, next) {
  try { res.status(200).json(await contentSpaceService.moveItemMembership({ fromContentSpaceId: req.params.contentSpaceId, toContentSpaceId: req.body?.targetContentSpaceId, itemId: req.params.itemId, actorUserId: req.user._id })); }
  catch (error) { next(error); }
}

module.exports = { create, list, get, update, remove, listItems, addItem, removeItem, moveItem };
