const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { assertCanUseEditorialContextForGeneration } = require("./editorialContextUsageAuthorization.service");

/**
 * API/service-boundary guard for generation before Marketplace Entitlement exists.
 *
 * An explicitly requested EditorialContext is usable when either:
 * - it is the primary Context endorsed by one of the selected Venue; or
 * - the actor can manage the Context ContentSpace.
 *
 * Invalid request shapes are left to generation validation; this guard only
 * authorizes valid-looking resource identifiers and never widens access.
 */
async function assertGenerationRequestAccess({ request = {}, actorUserId }) {
  const explicitContextIds = Array.isArray(request.editorialContextIds)
    ? request.editorialContextIds.filter((value) => mongoose.isValidObjectId(value))
    : [];
  if (!explicitContextIds.length) return;

  const venueIds = Array.isArray(request.venueIds)
    ? request.venueIds.filter((value) => mongoose.isValidObjectId(value))
    : [];
  const venues = venueIds.length
    ? await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).select("primaryEditorialContextId").lean()
    : [];
  const venuePrimaryContextIds = venues
    .map((venue) => venue.primaryEditorialContextId)
    .filter(Boolean)
    .map(String);

  const contexts = await EditorialContext.find({
    _id: { $in: explicitContextIds },
    lifecycleStatus: "active",
  });
  const byId = new Map(contexts.map((context) => [String(context._id), context]));

  for (const contextId of explicitContextIds) {
    const editorialContext = byId.get(String(contextId));
    if (!editorialContext) throw new AppError("EditorialContext non disponibile", 404);
    await assertCanUseEditorialContextForGeneration({
      editorialContext,
      actorUserId,
      venuePrimaryContextIds,
    });
  }
}

module.exports = { assertGenerationRequestAccess };
