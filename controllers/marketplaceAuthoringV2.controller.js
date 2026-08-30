const { listVenueAuthoringTargets } = require("../services/venueAuthoringTargetsV2.service");
const { getEditorialReleaseComposer } = require("../services/editorialReleaseComposerV2.service");
const { getVisitAuthoringProjection, searchVisitAuthoringContent, searchVisitAuthoringCandidates } = require("../services/visitAuthoringV2.service");

async function venueAuthoringTargets(req, res, next) {
  try {
    res.status(200).json(await listVenueAuthoringTargets({ venueId: req.params.venueId }));
  } catch (error) { next(error); }
}

async function editorialReleaseComposer(req, res, next) {
  try {
    res.status(200).json(await getEditorialReleaseComposer({
      editorialContextId: req.params.editorialContextId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function newVisitAuthoring(req, res, next) {
  try {
    res.status(200).json(await getVisitAuthoringProjection({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
    }));
  } catch (error) { next(error); }
}

async function visitAuthoring(req, res, next) {
  try {
    res.status(200).json(await getVisitAuthoringProjection({
      actorUserId: req.user._id,
      visitId: req.params.visitId,
    }));
  } catch (error) { next(error); }
}

async function visitAuthoringContent(req, res, next) {
  try {
    res.status(200).json(await searchVisitAuthoringContent({
      actorUserId: req.user._id,
      editorialReleaseId: req.params.editorialReleaseId,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
      queryText: req.query?.q || "",
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function visitAuthoringCandidates(req, res, next) {
  try {
    res.status(200).json(await searchVisitAuthoringCandidates({
      actorUserId: req.user._id,
      visitId: req.params.visitId,
      queryText: req.query?.q || "",
      access: req.query?.access || "all",
      source: req.query?.source || "all",
      venueId: req.query?.venueId || null,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

module.exports = {
  venueAuthoringTargets,
  editorialReleaseComposer,
  newVisitAuthoring,
  visitAuthoring,
  visitAuthoringContent,
  visitAuthoringCandidates,
};
