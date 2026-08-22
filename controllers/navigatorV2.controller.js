const service = require("../services/navigatorVisitV2.service");

async function library(req, res, next) {
  try {
    res.status(200).json(await service.listNavigatorLibrary({
      userId: req.user._id,
      configuredVenueId: req.query?.configuredVenueId || null,
    }));
  } catch (error) { next(error); }
}

async function visitDetail(req, res, next) {
  try {
    res.status(200).json(await service.getNavigatorVisitDetail({ userId: req.user._id, visitId: req.params.visitId }));
  } catch (error) { next(error); }
}

async function resumableSessions(req, res, next) {
  try {
    res.status(200).json(await service.listResumableNavigatorSessions({ userId: req.user._id }));
  } catch (error) { next(error); }
}

module.exports = { library, visitDetail, resumableSessions };
