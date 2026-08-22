const service = require("../services/itemV2.service");
const authoring = require("../services/itemAuthoringV2.service");
async function create(req, res, next) { try { res.status(201).json(await service.createItem({ payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function list(req, res, next) { try { res.status(200).json(await service.listItems(req.query || {})); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.status(200).json(await service.getItem({ itemId: req.params.itemId })); } catch (error) { next(error); } }
async function createEdition(req, res, next) { try { res.status(201).json(await service.createEdition({ itemId: req.params.itemId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function updateEdition(req, res, next) { try { res.status(200).json(await service.updateEdition({ editionId: req.params.editionId, payload: req.body || {}, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function checkEdition(req, res, next) { try { res.status(200).json(await authoring.checkEditionConsistency({ editionId: req.params.editionId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestEditionReview(req, res, next) { try { res.status(200).json(await service.requestEditionReview({ editionId: req.params.editionId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function withdrawEditionReview(req, res, next) { try { res.status(200).json(await service.withdrawEditionReview({ editionId: req.params.editionId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function requestEditionChanges(req, res, next) { try { res.status(200).json(await service.requestEditionChanges({ editionId: req.params.editionId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publishEdition(req, res, next) { try { res.status(200).json(await service.publishEdition({ editionId: req.params.editionId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function fork(req, res, next) { try { res.status(201).json(await service.forkItem({ sourceItemId: req.params.itemId, sourceEditionId: req.body?.sourceEditionId, ownerType: req.body?.ownerType, ownerId: req.body?.ownerId, actorUserId: req.user._id })); } catch (error) { next(error); } }
module.exports = {
  create,
  list,
  get,
  createEdition,
  updateEdition,
  checkEdition,
  requestEditionReview,
  withdrawEditionReview,
  requestEditionChanges,
  publishEdition,
  fork,
};
