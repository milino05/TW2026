const visitService = require("../services/visit.service");
const visitIntegrityService = require("../services/visitIntegrity.service");

async function createVisit(req, res, next) {
  try { res.status(201).json(await visitService.createVisit({ payload: req.body, actorUserId: req.user._id })); } catch (error) { next(error); }
}
async function updateVisit(req, res, next) {
  try { res.status(200).json(await visitService.updateVisit({ visitId: req.params.visitId, payload: req.body, actorUserId: req.user._id })); } catch (error) { next(error); }
}
async function listPublishedVisits(req, res, next) {
  try { res.status(200).json(await visitService.listPublishedVisits({ kind: req.query.kind, ownerMuseumId: req.query.ownerMuseumId, includedMuseumId: req.query.includedMuseumId })); } catch (error) { next(error); }
}
async function listMyVisits(req, res, next) {
  try { res.status(200).json(await visitService.listManageableVisits(req.user._id)); } catch (error) { next(error); }
}
async function getVisit(req, res, next) {
  try { res.status(200).json(await visitService.getVisit({ visitId: req.params.visitId, actorUserId: req.user?._id || null, view: req.query.view === "working" ? "working" : "published" })); } catch (error) { next(error); }
}
async function checkVisitConsistency(req, res, next) {
  try { res.status(200).json(await visitIntegrityService.checkVisitConsistency({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); }
}
async function requestVisitReview(req, res, next) {
  try { res.status(200).json(await visitIntegrityService.requestVisitReview({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); }
}
async function withdrawVisitReview(req, res, next) {
  try { res.status(200).json(await visitIntegrityService.withdrawVisitReview({ visitId: req.params.visitId, actorUserId: req.user._id })); } catch (error) { next(error); }
}
async function requestVisitChanges(req, res, next) {
  try { res.status(200).json(await visitIntegrityService.requestVisitChanges({ visitId: req.params.visitId, actorUserId: req.user._id, message: req.body?.message })); } catch (error) { next(error); }
}
async function publishVisit(req, res, next) {
  try { res.status(200).json({ message: "Revisione della visita pubblicata", ...(await visitIntegrityService.publishVisit({ visitId: req.params.visitId, actorUserId: req.user._id })) }); } catch (error) { next(error); }
}
async function trashVisit(req, res, next) {
  try { res.status(200).json({ message: "Visita spostata nel cestino", visit: await visitService.trashVisit({ visitId: req.params.visitId, actorUserId: req.user._id }) }); } catch (error) { next(error); }
}
async function restoreVisit(req, res, next) {
  try { res.status(200).json({ message: "Visita ripristinata", visit: await visitService.restoreVisit({ visitId: req.params.visitId, actorUserId: req.user._id }) }); } catch (error) { next(error); }
}
async function hardDeleteVisit(req, res, next) {
  try { const visit = await visitService.hardDeleteVisit({ visitId: req.params.visitId, actorUserId: req.user._id }); res.status(200).json({ message: "Visita eliminata definitivamente", visitId: visit._id }); } catch (error) { next(error); }
}

module.exports = {
  createVisit,
  updateVisit,
  listPublishedVisits,
  listMyVisits,
  getVisit,
  checkVisitConsistency,
  requestVisitReview,
  withdrawVisitReview,
  requestVisitChanges,
  publishVisit,
  trashVisit,
  restoreVisit,
  hardDeleteVisit,
};
