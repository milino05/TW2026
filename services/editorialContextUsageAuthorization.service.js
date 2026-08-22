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

async function assertCanUseEditorialContextForGeneration({ editorialContext, actorUserId }) {
  const { editorialContext: context } = await loadEditorialContextUsageDependencies(editorialContext);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.generate",
    resourceType: "editorial_context",
    resourceId: context._id,
  });
  return { editorialContext: context, access };
}

async function assertCanUseEditorialContextAsVenuePrimary({ editorialContextId, actorUserId }) {
  if (!editorialContextId) return null;
  const { editorialContext } = await loadEditorialContextUsageDependencies(editorialContextId);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "context.use_as_venue_primary",
    resourceType: "editorial_context",
    resourceId: editorialContext._id,
  });
  return { editorialContext, access };
}

module.exports = {
  loadEditorialContextUsageDependencies,
  assertCanUseEditorialContextForGeneration,
  assertCanUseEditorialContextAsVenuePrimary,
};
