const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");

function clean(value) { return String(value || "").trim(); }
function sameId(left, right) { return String(left || "") === String(right || ""); }

async function createEditorialStudioCollection({ payload, actorUserId }) {
  const ownerType = payload?.ownerType;
  const ownerId = payload?.ownerId;
  const namespaceId = payload?.namespaceId;
  const requestedSemanticGraphId = payload?.semanticGraphId || null;
  const displayName = clean(payload?.displayName);
  const shortDescription = clean(payload?.shortDescription) || null;
  const description = clean(payload?.description) || null;
  const requestedContentSpaceId = payload?.contentSpaceId || null;
  const newContentSpaceName = clean(payload?.newContentSpaceName);
  const newContentSpaceDescription = clean(payload?.newContentSpaceDescription) || null;

  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  if (!mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400, [{ field: "ownerId", code: "INVALID_OBJECT_ID" }]);
  if (!mongoose.isValidObjectId(namespaceId)) throw new AppError("namespaceId non valido", 400, [{ field: "namespaceId", code: "INVALID_OBJECT_ID" }]);
  if (requestedSemanticGraphId && !mongoose.isValidObjectId(requestedSemanticGraphId)) throw new AppError("semanticGraphId non valido", 400, [{ field: "semanticGraphId", code: "INVALID_OBJECT_ID" }]);
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
    if (existingSpace.ownerType !== ownerType || !sameId(existingSpace.ownerId, ownerId)) {
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
  const authorizedNamespaceRef = namespaceAccess?.resolvedSnapshotRef;
  const namespaceRevisionId = authorizedNamespaceRef?.resourceType === "namespace_revision"
    ? authorizedNamespaceRef.resourceId
    : namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!namespaceRevisionId) {
    throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409, [{ code: "NAMESPACE_REVISION_REQUIRED" }]);
  }
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: namespace._id }).select("_id").lean();
  if (!namespaceRevision) {
    throw new AppError("La revisione delle regole editoriali non è disponibile", 409, [{ code: "NAMESPACE_REVISION_NOT_AVAILABLE" }]);
  }

  let semanticGraph = null;
  if (requestedSemanticGraphId) {
    semanticGraph = await SemanticGraph.findOne({ _id: requestedSemanticGraphId, lifecycleStatus: "active" });
    if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 404);
    if (semanticGraph.ownerType !== ownerType || !sameId(semanticGraph.ownerId, ownerId)) {
      throw new AppError("Il grafo semantico non appartiene all'area di lavoro selezionata", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
    }
    if (!sameId(semanticGraph.namespaceId, namespace._id)) {
      throw new AppError("Il grafo semantico usa regole editoriali diverse", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
    }
    if (!semanticGraph.workingRevisionId) {
      throw new AppError("Il grafo semantico non ha una revisione di lavoro", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_REQUIRED" }]);
    }
  }

  let contentSpace = existingSpace;
  let editorialContext = null;
  let createdSpace = false;
  let createdGraph = false;
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
      if (!semanticGraph) {
        [semanticGraph] = await SemanticGraph.create([{
          namespaceId: namespace._id,
          displayName: `${displayName} · Relazioni`,
          ownerType,
          ownerId,
          createdBy: actorUserId,
        }], { session });
        const [initialRevision] = await SemanticGraphRevision.create([{
          semanticGraphId: semanticGraph._id,
          version: 1,
          basedOnRevisionId: null,
          authoredAgainstNamespaceRevisionId: namespaceRevision._id,
          createdBy: actorUserId,
        }], { session });
        semanticGraph.workingRevisionId = initialRevision._id;
        semanticGraph.workingVersion = 1;
        await semanticGraph.save({ session });
        createdGraph = true;
      }
      [editorialContext] = await EditorialContext.create([{
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        semanticGraphId: semanticGraph._id,
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
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: namespaceRevision._id },
      resultResourceRef: { resourceType: "editorial_context", resourceId: editorialContext._id },
    });
    return {
      contentSpace: { id: contentSpace._id, name: contentSpace.name, created: createdSpace },
      semanticGraph: { id: semanticGraph._id, name: semanticGraph.displayName, created: createdGraph },
      editorialContext: await projectEditorialContext({ editorialContext, contentSpace, namespace }),
      adoptionId: adoption?._id || null,
    };
  } catch (error) {
    if (editorialContext?._id) await EditorialContext.deleteOne({ _id: editorialContext._id }).catch(() => {});
    if (createdGraph && semanticGraph?._id) {
      const revisionIds = await SemanticGraphRevision.find({ semanticGraphId: semanticGraph._id }).distinct("_id").catch(() => []);
      await Promise.allSettled([
        SemanticGraphRevision.deleteMany({ semanticGraphId: semanticGraph._id }),
        SemanticGraph.deleteOne({ _id: semanticGraph._id }),
        ...(revisionIds.length ? [] : []),
      ]);
    }
    if (createdSpace && contentSpace?._id) await ContentSpace.deleteOne({ _id: contentSpace._id }).catch(() => {});
    throw error;
  }
}

module.exports = { createEditorialStudioCollection };
