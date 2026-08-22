const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail } = require("./contentSpace.service");
const { assertCapability } = require("./capabilityAuthorization.service");

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
  await assertCapability({
    actorUserId,
    capability: "context.generate",
    resourceType: "editorial_context",
    resourceId: context._id,
  });
  return context;
}

async function assertCanUseEditorialContextAsVenuePrimary({ editorialContextId, actorUserId }) {
  if (!editorialContextId) return null;
  const { editorialContext } = await loadEditorialContextUsageDependencies(editorialContextId);
  await assertCapability({
    actorUserId,
    capability: "context.use_as_venue_primary",
    resourceType: "editorial_context",
    resourceId: editorialContext._id,
  });
  return editorialContext;
}

module.exports = {
  loadEditorialContextUsageDependencies,
  assertCanUseEditorialContextForGeneration,
  assertCanUseEditorialContextAsVenuePrimary,
};
