const visitService = require("../services/visit.service");
const visitIntegrityService = require("../services/visitIntegrity.service");

async function createVisit(req, res, next) {
  try {
    const visit = await visitService.createVisit({
      payload: req.body,
      actorUserId: req.user._id,
    });
    res.status(201).json(visit);
  } catch (error) {
    next(error);
  }
}

async function updateVisit(req, res, next) {
  try {
    const visit = await visitService.updateVisit({
      visitId: req.params.visitId,
      payload: req.body,
      actorUserId: req.user._id,
    });
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function listPublishedVisits(req, res, next) {
  try {
    const visits = await visitService.listPublishedVisits({
      kind: req.query.kind,
      ownerMuseumId: req.query.ownerMuseumId,
      includedMuseumId: req.query.includedMuseumId,
    });
    res.status(200).json(visits);
  } catch (error) {
    next(error);
  }
}

async function listMyVisits(req, res, next) {
  try {
    const visits = await visitService.listManageableVisits(req.user._id);
    res.status(200).json(visits);
  } catch (error) {
    next(error);
  }
}

async function getVisit(req, res, next) {
  try {
    const visit = await visitService.getVisit({
      visitId: req.params.visitId,
      actorUserId: req.user?._id || null,
    });
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function checkVisitConsistency(req, res, next) {
  try {
    const result = await visitIntegrityService.checkVisitConsistency({
      visitId: req.params.visitId,
      actorUserId: req.user._id,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function publishVisit(req, res, next) {
  try {
    const visit = await visitIntegrityService.publishVisit({
      visitId: req.params.visitId,
      actorUserId: req.user._id,
    });
    res.status(200).json({ message: "Visita pubblicata", visit });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createVisit,
  updateVisit,
  listPublishedVisits,
  listMyVisits,
  getVisit,
  checkVisitConsistency,
  publishVisit,
};
