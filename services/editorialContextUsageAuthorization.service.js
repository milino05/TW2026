const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");

async function assertCanUseEditorialContextAsVenuePrimary({ editorialContextId, actorUserId }) {
  if (!editorialContextId) return null;
  const editorialContext = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!editorialContext) throw new AppError("EditorialContext primario non disponibile", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: editorialContext.contentSpaceId });
  // Temporary policy boundary: until adoption/entitlement exists, using a
  // Context as a Venue default requires editorial authority over its space.
  await assertCanManageContentSpace(contentSpace, actorUserId);
  return editorialContext;
}

module.exports = { assertCanUseEditorialContextAsVenuePrimary };
