const itemService = require("../services/item.service");
const itemRelationsService = require("../services/itemRelations.service");
const itemIntegrityService = require("../services/itemIntegrity.service");

async function createItem(req, res, next) {
  try {
    res.status(201).json(await itemService.createItem({ museumId: req.params.museumId, payload: req.body, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function updateItem(req, res, next) {
  try {
    res.status(200).json(await itemService.updateItem({ museumId: req.params.museumId, itemId: req.params.itemId, payload: req.body, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function listItems(req, res, next) {
  try {
    res.status(200).json(await itemService.listItems({
      museumId: req.params.museumId,
      actorUserId: req.user?._id || null,
      view: req.query.view === "working" ? "working" : "published",
      filters: {
        itemType: req.query.itemType,
        status: req.query.status,
        integrity: req.query.integrity,
        includeTrashed: req.query.includeTrashed === "true" || req.query.includeTrashed === "1",
      },
    }));
  } catch (error) { next(error); }
}

async function getItem(req, res, next) {
  try {
    const view = req.query.view === "working" ? "working" : "published";
    const result = await itemService.getItemById({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
      actorUserId: req.user?._id || null,
      view,
    });
    if (req.query.includeRelationsView === "true" || req.query.includeRelationsView === "1") {
      result.relationsView = await itemRelationsService.getItemRelationsView({
        museumId: req.params.museumId,
        itemId: req.params.itemId,
        actorUserId: req.user?._id || null,
        view,
      });
    }
    res.status(200).json(result);
  } catch (error) { next(error); }
}

async function checkItemConsistency(req, res, next) {
  try {
    res.status(200).json(await itemIntegrityService.checkItemConsistency({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function requestItemReview(req, res, next) {
  try {
    res.status(200).json(await itemIntegrityService.requestItemReview({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function withdrawItemReview(req, res, next) {
  try {
    res.status(200).json(await itemIntegrityService.withdrawItemReview({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id }));
  } catch (error) { next(error); }
}

async function requestItemChanges(req, res, next) {
  try {
    res.status(200).json(await itemIntegrityService.requestItemChanges({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id, message: req.body?.message }));
  } catch (error) { next(error); }
}

async function publishItem(req, res, next) {
  try {
    const result = await itemIntegrityService.publishItem({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id });
    res.status(200).json({ message: "Revisione dell'item pubblicata", ...result });
  } catch (error) { next(error); }
}

async function trashItem(req, res, next) {
  try {
    const item = await itemService.trashItem({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id });
    res.status(200).json({ message: "Item spostato nel cestino", item });
  } catch (error) { next(error); }
}

async function restoreItem(req, res, next) {
  try {
    const item = await itemService.restoreItem({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id });
    res.status(200).json({ message: "Item ripristinato", item });
  } catch (error) { next(error); }
}

async function hardDeleteItem(req, res, next) {
  try {
    const item = await itemService.hardDeleteItem({ museumId: req.params.museumId, itemId: req.params.itemId, userId: req.user._id });
    res.status(200).json({ message: "Item eliminato definitivamente", itemId: item._id });
  } catch (error) { next(error); }
}

module.exports = {
  createItem,
  updateItem,
  listItems,
  getItem,
  checkItemConsistency,
  requestItemReview,
  withdrawItemReview,
  requestItemChanges,
  publishItem,
  trashItem,
  restoreItem,
  hardDeleteItem,
};
