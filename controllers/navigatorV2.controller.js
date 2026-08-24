const service = require("../services/navigatorVisitV2.service");
const generationOptions = require("../services/generationOptionsV2.service");
const generationSemanticOptions = require("../services/generationSemanticOptionsV2.service");

async function museums(req, res, next) {
  try {
    res.status(200).json(await service.listNavigatorMuseums({ userId: req.user._id }));
  } catch (error) { next(error); }
}

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
    res.status(200).json(await service.getNavigatorVisitDetail({
      userId: req.user._id,
      visitId: req.params.visitId,
      configuredVenueId: req.query?.configuredVenueId || null,
    }));
  } catch (error) { next(error); }
}

async function resumableSessions(req, res, next) {
  try {
    res.status(200).json(await service.listResumableNavigatorSessions({
      userId: req.user._id,
      configuredVenueId: req.query?.configuredVenueId || null,
    }));
  } catch (error) { next(error); }
}

async function dismissResumableSession(req, res, next) {
  try {
    res.status(200).json(await service.dismissResumableNavigatorSession({
      userId: req.user._id,
      sessionId: req.params.sessionId,
    }));
  } catch (error) { next(error); }
}

async function generationOptionsProjection(req, res, next) {
  try {
    res.status(200).json(await generationOptions.getGenerationOptionsProjection({
      actorUserId: req.user._id,
      selectedVenueIds: req.query?.selectedVenueIds || [],
    }));
  } catch (error) { next(error); }
}

async function generationSubjectOptions(req, res, next) {
  try {
    res.status(200).json(await generationSemanticOptions.searchGenerationSubjectsV2({
      actorUserId: req.user._id,
      editorialSources: req.body?.editorialSources || [],
      query: req.body?.query || "",
      limit: req.body?.limit || 20,
    }));
  } catch (error) { next(error); }
}

module.exports = {
  museums,
  library,
  visitDetail,
  resumableSessions,
  dismissResumableSession,
  generationOptionsProjection,
  generationSubjectOptions,
};