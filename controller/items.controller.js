const itemService = require("../services/item.service");
const vocabularyService = require("../services/museumVocabulary.service");

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

async function getEditorVocabulary(req, res, next) {
  try {
    const vocabulary = await vocabularyService.getMuseumVocabulary(req.params.museumId);

    res.status(200).json(vocabulary);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createItem,
  updateItem,
  getEditorVocabulary,
};
