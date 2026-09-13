const venueSubjectResolverService = require("../services/venueSubjectResolver.service");

async function searchSubjectCandidates(req, res, next) {
  try {
    res.status(200).json(await venueSubjectResolverService.searchVenueSubjectCandidates({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
      query: req.query?.query || req.query?.q || "",
      limit: req.query?.limit,
      page: req.query?.page,
    }));
  } catch (error) { next(error); }
}

module.exports = { searchSubjectCandidates };
