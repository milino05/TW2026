const itemService = require("../services/item.service");
const itemRelationsService = require("../services/itemRelations.service");
const itemIntegrityService = require("../services/itemIntegrity.service");

async function createItem(req, res, next) {
  try {
    const item = await itemService.createItem({
      museumId: req.params.museumId,
      payload: req.body,
      userId: req.user?._id || null,
    });

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

async function updateItem(req, res, next) {
  try {
    const item = await itemService.updateItem({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
      payload: req.body,
      userId: req.user?._id || null,
    });

    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
}

async function listItems(req, res, next) {
  try {
    const items = await itemService.listItems({
      museumId: req.params.museumId,
      filters: {
        itemType: req.query.itemType,
        status: req.query.status,
        integrity: req.query.integrity,
      },
    });

    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
}

/**per vedere anche le relazioni:
 * GET /api/museums/:museumId/items/:itemId?includeRelationsView=true */
async function getItem(req, res, next) {
  try {
    const item = await itemService.getItemById({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
    });

    const includeRelationsView = req.query.includeRelationsView === "true" || req.query.includeRelationsView === "1";

    if (includeRelationsView) {
      const relationsView = await itemRelationsService.getItemRelationsView({
        museumId: req.params.museumId,
        itemId: req.params.itemId,
      });

      return res.status(200).json({
        item,
        relationsView,
      });
    }

    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
}

async function checkItemConsistency(req, res, next) {
  try {
    const result = await itemIntegrityService.checkItemConsistency({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
    });

    res.status(200).json({
      item: result.item,
      integrity: result.integrity,
      issues: result.issues,
    });
  } catch (err) {
    next(err);
  }
}

async function publishItem(req, res, next) {
  try {
    const item = await itemIntegrityService.publishItem({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
    });

    res.status(200).json({
      message: "Item pubblicato",
      item,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteItem(req, res, next) {
  try {
    const result = await itemService.deleteItem({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
      userId: req.user?._id || null,
    });

    res.status(200).json({
      message: "Item eliminato",
      itemId: result.item._id,
      affectedItemsCount: result.affectedItemsCount,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createItem,
  updateItem,
  listItems,
  getItem,
  checkItemConsistency,
  publishItem,
  deleteItem,
};
