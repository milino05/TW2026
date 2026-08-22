const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");

async function loadEditorialContextUsageDependencies(editorialContextOrId) {
  const editorialContext = editorialContextOrId?._id
    ? editorialContextOrId
    : await EditorialContext.findOne({ _id: editorialContextOrId, lifecycleStatus: "active" });
  if (!editorialContext) throw new AppError("EditorialContext non disponibile", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: editorialContext.contentSpaceId });
  return { editorialContext, contentSpace };
}

/**
 * Temporary pre-Marketplace policy for context.generate.
 * A selected Venue may endorse a Context as its primary source, making that
 * Context usable for generation in that Venue. Any other explicit Context is
 * restricted to actors who can manage its ContentSpace until Entitlement
 * capability `context.generate` is implemented.
 */
async function assertCanUseEditorialContextForGeneration({
  editorialContext,
  actorUserId,
  venuePrimaryContextIds = [],
}) {
  const { editorialContext: context, contentSpace } = await loadEditorialContextUsageDependencies(editorialContext);
  const primaryIds = new Set((venuePrimaryContextIds || []).map(String));
  if (primaryIds.has(String(context._id))) return context;
  await assertCanManageContentSpace(contentSpace, actorUserId);
  return context;
}

async function assertCanUseEditorialContextAsVenuePrimary({ editorialContextId, actorUserId }) {
  if (!editorialContextId) return null;
  const { editorialContext, contentSpace } = await loadEditorialContextUsageDependencies(editorialContextId);
  // Temporary policy boundary: future `context.use_as_venue_primary`
  // Entitlement belongs here instead of inside Venue or EditorialContext.
  await assertCanManageContentSpace(contentSpace, actorUserId);
  return editorialContext;
}

module.exports = {
  loadEditorialContextUsageDependencies,
  assertCanUseEditorialContextForGeneration,
  assertCanUseEditorialContextAsVenuePrimary,
};
