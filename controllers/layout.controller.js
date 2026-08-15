const service = require("../services/layout.service");
const { getRoutingAttributeCatalog } = require("../services/routingAttributeCatalog.service");

async function catalog(req, res, next) { try { res.json(getRoutingAttributeCatalog()); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.json(await service.getLayout({ museumId: req.params.museumId, actorUserId: req.user?._id, view: req.query.view })); } catch (error) { next(error); } }
async function update(req, res, next) { try { res.json(await service.updateLayout({ museumId: req.params.museumId, actorUserId: req.user._id, payload: req.body })); } catch (error) { next(error); } }
async function check(req, res, next) { try { res.json(await service.checkConsistency({ museumId: req.params.museumId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function review(req, res, next) { try { res.json(await service.submitReview({ museumId: req.params.museumId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function withdraw(req, res, next) { try { res.json(await service.withdraw({ museumId: req.params.museumId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function changes(req, res, next) { try { res.json(await service.changes({ museumId: req.params.museumId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publish(req, res, next) { try { res.json(await service.publish({ museumId: req.params.museumId, actorUserId: req.user._id })); } catch (error) { next(error); } }
module.exports = { catalog, get, update, check, review, withdraw, changes, publish };
