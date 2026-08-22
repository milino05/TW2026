const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { assertCanUseEditorialContextForGeneration } = require("./editorialContextUsageAuthorization.service");

/**
 * Authorization boundary for explicit generator editorial sources.
 * Venue.primaryEditorialContextId may be used by a generation-options resolver
 * as a default/recommendation, but it is never an authorization grant.
 *
 * The current GenerationRequest accepts live EditorialContext IDs only. A
 * pinned context.generate entitlement resolves to an EditorialRelease and must
 * therefore wait for the typed live/snapshot source contract of Slice 7 rather
 * than silently switching to the publisher's current release.
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
    const { access } = await assertCanUseEditorialContextForGeneration({ editorialContext, actorUserId });
    if (access.basis === "entitlement" && access.entitlement?.versionPolicy === "pinned") {
      throw new AppError("La sorgente editoriale pinned richiede un riferimento EditorialRelease tipizzato", 409, [{
        code: "PINNED_GENERATION_SOURCE_REQUIRES_TYPED_SOURCE",
        context: { editorialContextId: editorialContext._id, resolvedSnapshotRef: access.resolvedSnapshotRef },
      }]);
    }
  }
}

module.exports = { assertGenerationRequestAccess };
