const { getMarketplaceAuthoringPreflight } = require("../services/marketplaceAuthoringPreflightV2.service");

async function authoringPreflight(req, res, next) {
  try {
    res.status(200).json(await getMarketplaceAuthoringPreflight({
      actorUserId: req.user._id,
      principalType: req.query?.principalType || "user",
      principalId: req.query?.principalId || req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = { authoringPreflight };