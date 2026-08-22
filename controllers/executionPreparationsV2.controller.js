const service = require("../services/executionPreparationV2.service");

async function create(req, res, next) {
  try {
    const preparation = await service.createExecutionPreparation({ userId: req.user._id, payload: req.body || {} });
    res.status(201).json({ preparation });
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    const preparation = await service.getExecutionPreparation({ preparationId: req.params.preparationId, userId: req.user._id });
    res.status(200).json({ preparation });
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    const preparation = await service.updateExecutionPreparation({
      preparationId: req.params.preparationId,
      userId: req.user._id,
      expectedVersion: req.body?.expectedVersion,
      payload: req.body || {},
    });
    res.status(200).json({ preparation });
  } catch (error) { next(error); }
}

async function start(req, res, next) {
  try {
    const result = await service.startExecutionPreparation({
      preparationId: req.params.preparationId,
      userId: req.user._id,
      expectedVersion: req.body?.expectedVersion,
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
}

module.exports = { create, get, update, start };
