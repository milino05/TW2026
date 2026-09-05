const service = require("../services/venueInventoryProposal.service");

async function submit(req, res, next) {
  try {
    const result = await service.submitVenueInventoryProposal({
      venueId: req.params.venueId,
      subjectId: req.body?.subjectId,
      sourceItemId: req.body?.sourceItemId || null,
      message: req.body?.message || null,
      actorUserId: req.user._id,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) { next(error); }
}

async function list(req, res, next) {
  try {
    res.status(200).json(await service.listVenueInventoryProposals({
      venueId: req.params.venueId,
      status: req.query?.status || "pending",
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function accept(req, res, next) {
  try {
    res.status(200).json(await service.acceptVenueInventoryProposal({
      venueId: req.params.venueId,
      proposalId: req.params.proposalId,
      message: req.body?.message || null,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function reject(req, res, next) {
  try {
    res.status(200).json(await service.rejectVenueInventoryProposal({
      venueId: req.params.venueId,
      proposalId: req.params.proposalId,
      message: req.body?.message,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function withdraw(req, res, next) {
  try {
    res.status(200).json(await service.withdrawVenueInventoryProposal({
      venueId: req.params.venueId,
      proposalId: req.params.proposalId,
      message: req.body?.message || null,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = { submit, list, accept, reject, withdraw };
