const itemService = require("../services/item.service");

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

async function getItem(req, res, next) {
  try {
    const item = await itemService.getItemById({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
    });

    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
}

async function deleteItem(req, res, next) {
  try {
    const item = await itemService.deleteItem({
      museumId: req.params.museumId,
      itemId: req.params.itemId,
    });

    res.status(200).json({
      message: "Item eliminato",
      itemId: item._id,
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
  deleteItem,
};
