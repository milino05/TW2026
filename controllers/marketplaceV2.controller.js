const service = require("../services/marketplaceVisitV2.service");

async function catalog(req, res, next) {
  try {
    res.status(200).json(await service.listVisitCatalog({
      actorUserId: req.user._id,
      venueId: req.query?.venueId || null,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    res.status(200).json(await service.getVisitListingDetail({ listingId: req.params.listingId, actorUserId: req.user._id }));
  } catch (error) { next(error); }
}

async function createVisitListing(req, res, next) {
  try {
    res.status(201).json(await service.createVisitListing({
      visitId: req.body?.visitId,
      sellerType: req.body?.sellerType,
      sellerId: req.body?.sellerId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function createVisitOffer(req, res, next) {
  try {
    res.status(201).json(await service.createVisitExecuteOffer({
      listingId: req.params.listingId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function acquire(req, res, next) {
  try {
    const result = await service.acquireOffer({
      offerId: req.params.offerId,
      actorUserId: req.user._id,
      beneficiaryType: req.body?.beneficiaryType || "user",
      beneficiaryId: req.body?.beneficiaryId || req.user._id,
    });
    res.status(result.alreadyAcquired ? 200 : 201).json(result);
  } catch (error) { next(error); }
}

module.exports = {
  catalog,
  detail,
  createVisitListing,
  createVisitOffer,
  acquire,
};
