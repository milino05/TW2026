const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");

function clean(value) { return String(value || "").trim(); }

async function createEditorialStudioCollection({ payload, actorUserId }) {
  const ownerType = payload?.ownerType;
  const ownerId = payload?.ownerId;
  const namespaceId = payload?.namespaceId;
  const displayName = clean(payload?.displayName);
  const shortDescription = clean(payload?.shortDescription) || null;
  const description = clean(payload?.description) || null;
  const requestedContentSpaceId = payload?.contentSpaceId || null;
  const newContentSpaceName = clean(payload?.newContentSpaceName);
  const newContentSpaceDescription = clean(payload?.newContentSpaceDescription) || null;

  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  if (!mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400, [{ field: "ownerId", code: "INVALID_OBJECT_ID" }]);
  if (!mongoose.isValidObjectId(namespaceId)) throw new AppError("namespaceId non valido", 400, [{ field: "namespaceId", code: "INVALID_OBJECT_ID" }]);
  if (!displayName) throw new AppError("Nome della raccolta obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);
  if (!requestedContentSpaceId && !newContentSpaceName) throw new AppError("Scegli uno spazio editoriale oppure indica il nome del nuovo spazio", 400, [{ code: "CONTENT_SPACE_REQUIRED" }]);
  if (requestedContentSpaceId && newContentSpaceName) throw new AppError("Scegli se usare uno spazio esistente o crearne uno nuovo", 400, [{ code: "CONTENT_SPACE_CHOICE_AMBIGUOUS" }]);

  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404);
  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_context.create" });

  let existingSpace = null;
  if (requestedContentSpaceId) {
    if (!mongoose.isValidObjectId(requestedContentSpaceId)) throw new AppError("contentSpaceId non valido", 400);
    existingSpace = await findContentSpaceOrFail({ contentSpaceId: requestedContentSpaceId });
    if (existingSpace.ownerType !== ownerType || String(existingSpace.ownerId) !== String(ownerId)) {
      throw new AppError("Lo spazio editoriale non appartiene all'area di lavoro selezionata", 409, [{ code: "CONTENT_SPACE_OWNER_MISMATCH" }]);
    }
    await assertCanManageContentSpace(existingSpace, actorUserId, "editorial_context.create");
  } else {
    await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_space.manage" });
  }

  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });

  let contentSpace = existingSpace;
  let editorialContext = null;
  let createdSpace = false;
  try {
    await mongoose.connection.transaction(async (session) => {
      if (!contentSpace) {
        [contentSpace] = await ContentSpace.create([{
          name: newContentSpaceName,
          description: newContentSpaceDescription,
          ownerType,
          ownerId,
          createdBy: actorUserId,
        }], { session });
        createdSpace = true;
      }
      [editorialContext] = await EditorialContext.create([{
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        displayName,
        shortDescription,
        description,
        createdBy: actorUserId,
      }], { session });
    });
    const adoption = await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: namespaceAccess.resolvedSnapshotRef,
      resultResourceRef: { resourceType: "editorial_context", resourceId: editorialContext._id },
    });
    return {
      contentSpace: { id: contentSpace._id, name: contentSpace.name, created: createdSpace },
      editorialContext: await projectEditorialContext({ editorialContext, contentSpace, namespace }),
      adoptionId: adoption?._id || null,
    };
  } catch (error) {
    if (editorialContext?._id) await EditorialContext.deleteOne({ _id: editorialContext._id }).catch(() => {});
    if (createdSpace && contentSpace?._id) await ContentSpace.deleteOne({ _id: contentSpace._id }).catch(() => {});
    throw error;
  }
}

module.exports = { createEditorialStudioCollection };
