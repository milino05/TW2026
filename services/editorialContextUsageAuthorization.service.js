const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail } = require("./contentSpace.service");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");

async function loadEditorialContextUsageDependencies(editorialContextOrId) {
  const editorialContext = editorialContextOrId?._id
    ? editorialContextOrId
    : await EditorialContext.findOne({ _id: editorialContextOrId, lifecycleStatus: "active" });
  if (!editorialContext) throw new AppError("EditorialContext non disponibile", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: editorialContext.contentSpaceId });
  return { editorialContext, contentSpace };
}

async function assertCanUseEditorialContextForGeneration({ editorialContext, actorUserId, principalType = null, principalId = null }) {
  const { editorialContext: context } = await loadEditorialContextUsageDependencies(editorialContext);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.generate",
    resourceType: "editorial_context",
    resourceId: context._id,
    principalType,
    principalId,
  });
  return { editorialContext: context, access };
}

async function assertCanUseEditorialContextAsVenuePrimary({ editorialContextId, actorUserId, principalType = null, principalId = null }) {
  if (!editorialContextId) return null;
  const { editorialContext } = await loadEditorialContextUsageDependencies(editorialContextId);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.use_as_venue_primary",
    resourceType: "editorial_context",
    resourceId: editorialContext._id,
    principalType,
    principalId,
  });
  if (access.basis === "entitlement" && access.entitlement?.versionPolicy === "pinned") {
    throw new AppError("Una EditorialRelease pinned non puo diventare il primary live di una Venue", 409, [{
      code: "PINNED_CONTEXT_CANNOT_BECOME_LIVE_VENUE_PRIMARY",
      context: { editorialContextId: editorialContext._id, resolvedSnapshotRef: access.resolvedSnapshotRef },
    }]);
  }
  return { editorialContext, access };
}

module.exports = {
  loadEditorialContextUsageDependencies,
  assertCanUseEditorialContextForGeneration,
  assertCanUseEditorialContextAsVenuePrimary,
};
