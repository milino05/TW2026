const museumService = require("../services/museum.service");
const vocabularyService = require("../services/museumVocabulary.service");

async function createMuseum(req, res, next) {
  try {
    const museum = await museumService.createMuseum({
      payload: req.body,
      actorUserId: req.user._id,
    });

    res.status(201).json(museum);
  } catch (err) {
    next(err);
  }
}

async function updateMuseum(req, res, next) {
  try {
    const museum = await museumService.updateMuseum({
      museumId: req.params.museumId,
      payload: req.body,
      actorUserId: req.user._id,
    });

    res.status(200).json(museum);
  } catch (err) {
    next(err);
  }
}

async function assignMuseumRole(req, res, next) {
  try {
    const membership = await museumService.assignMuseumRole({
      museumId: req.params.museumId,
      targetUserId: req.params.userId,
      role: req.body?.role,
      actorUserId: req.user._id,
    });

    res.status(200).json(membership);
  } catch (err) {
    next(err);
  }
}

async function listMuseums(req, res, next) {
  try {
    const museums = await museumService.listMuseums();
    res.status(200).json(museums);
  } catch (err) {
    next(err);
  }
}

async function getMuseum(req, res, next) {
  try {
    const museum = await museumService.getMuseumById({
      museumId: req.params.museumId,
    });

    res.status(200).json(museum);
  } catch (err) {
    next(err);
  }
}

async function deleteMuseum(req, res, next) {
  try {
    const museum = await museumService.deleteMuseum({
      museumId: req.params.museumId,
      actorUserId: req.user._id,
    });

    res.status(200).json({
      message: "Museo eliminato",
      museumId: museum._id,
    });
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

async function getItemTypeVocabulary(req, res, next) {
  try {
    const vocabulary = await vocabularyService.getItemTypeVocabulary({
      museumId: req.params.museumId,
      itemType: req.params.itemType,
    });

    res.status(200).json(vocabulary);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  listMuseums,
  getMuseum,
  deleteMuseum,
  getEditorVocabulary,
  getItemTypeVocabulary,
};
