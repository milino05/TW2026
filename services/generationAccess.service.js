const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { assertCanUseEditorialContextForGeneration } = require("./editorialContextUsageAuthorization.service");

/**
 * Authorization boundary for explicit generator editorial sources.
 * Venue.primaryEditorialContextId may be used by a generation-options resolver
 * as a default/recommendation, but it is never an authorization grant.
 */
async function assertGenerationRequestAccess({ request = {}, actorUserId }) {
  const explicitContextIds = Array.isArray(request.editorialContextIds)
    ? request.editorialContextIds.filter((value) => mongoose.isValidObjectId(value))
    : [];
  if (!explicitContextIds.length) return;

  const contexts = await EditorialContext.find({
    _id: { $in: explicitContextIds },
    lifecycleStatus: "active",
  });
  const byId = new Map(contexts.map((context) => [String(context._id), context]));

  for (const contextId of explicitContextIds) {
    const editorialContext = byId.get(String(contextId));
    if (!editorialContext) throw new AppError("EditorialContext non disponibile", 404);
    await assertCanUseEditorialContextForGeneration({ editorialContext, actorUserId });
  }
}

module.exports = { assertGenerationRequestAccess };
