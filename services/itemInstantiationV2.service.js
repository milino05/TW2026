const mongoose = require("mongoose");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { assertCanForkItemEdition } = require("./itemUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { clonePresentationForFork, validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const { validateCreateItemPayload } = require("./validation/itemV2.validation");

function sameId(a, b) { return String(a || "") === String(b || ""); }

function revisionPayload(revision) {
  const source = revision?.toObject ? revision.toObject() : revision || {};
  const fields = [
    "label", "relatedSubjectIds", "tags", "authorCredits", "metadata", "illustrativeMedia",
    "selectionSignals", "presentationVariants", "defaultPresentation", "provenance",
  ];
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

async function assertTargetContentSpace({ contentSpaceId, ownerType, ownerId, actorUserId }) {
  if (!mongoose.isValidObjectId(contentSpaceId)) {
    throw new AppError("Spazio editoriale di destinazione non valido", 400, [{
      field: "contentSpaceId",
      code: "INVALID_OBJECT_ID",
    }]);
  }
  await assertCanActForOwner({
    actorUserId,
    ownerType,
    ownerId,
    permissionCode: "editorial_space.view",
  });
  const contentSpace = await ContentSpace.findOne({
    _id: contentSpaceId,
    lifecycleStatus: "active",
  }).select("_id ownerType ownerId");
  if (!contentSpace) throw new AppError("Spazio editoriale non trovato", 404);
  if (contentSpace.ownerType !== ownerType || !sameId(contentSpace.ownerId, ownerId)) {
    throw new AppError("Lo spazio editoriale non appartiene al titolare del contenuto", 409, [{
      field: "contentSpaceId",
      code: "CONTENT_SPACE_OWNER_MISMATCH",
    }]);
  }
  return contentSpace;
}

async function createSpaceMemberships({ contentSpace, item, subjectId, actorUserId, session }) {
  await ContentSpaceSubjectMembership.findOneAndUpdate(
    { contentSpaceId: contentSpace._id, subjectId },
    { $setOnInsert: { contentSpaceId: contentSpace._id, subjectId, addedBy: actorUserId } },
    { upsert: true, new: true, session },
  );
  await ContentSpaceItemMembership.create([{
    contentSpaceId: contentSpace._id,
    itemId: item._id,
    addedBy: actorUserId,
  }], { session });
}

async function createItem({ payload, actorUserId }) {
  const issues = validateCreateItemPayload(payload || {});
  if (issues.length) throw new AppError("Payload non valido", 400, issues);
  await assertCanActForOwner({
    actorUserId,
    ownerType: payload.ownerType,
    ownerId: payload.ownerId,
    permissionCode: "item.create",
  });
  const [subject, contentSpace] = await Promise.all([
    Subject.findById(payload.primarySubjectId).select("_id"),
    assertTargetContentSpace({
      contentSpaceId: payload.contentSpaceId,
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      actorUserId,
    }),
  ]);
  if (!subject) throw new AppError("Subject non trovato", 404);

  let item = null;
  await mongoose.connection.transaction(async (session) => {
    [item] = await ItemV2.create([{
      primarySubjectId: subject._id,
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      provenance: payload.provenance || { origin: "human" },
      createdBy: actorUserId,
    }], { session });
    await createSpaceMemberships({
      contentSpace,
      item,
      subjectId: subject._id,
      actorUserId,
      session,
    });
  });
  return item;
}

async function resolveNamespaceRevision(namespace, requestedRevisionId = null) {
  const revisionId = requestedRevisionId || namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!revisionId) throw new AppError("Il Namespace non ha una revisione disponibile", 409);
  const revision = await NamespaceRevision.findOne({ _id: revisionId, namespaceId: namespace._id });
  if (!revision) throw new AppError("NamespaceRevision non trovata", 404);
  return revision;
}

async function resolveNamespaceRevisionForAuthoring({ namespace, access }) {
  if (access?.basis !== "entitlement") return resolveNamespaceRevision(namespace);
  const ref = access.resolvedSnapshotRef;
  if (ref?.resourceType !== "namespace_revision") {
    throw new AppError("Entitlement Namespace senza snapshot di authoring", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_REQUIRED" }]);
  }
  const revision = await NamespaceRevision.findOne({
    _id: ref.resourceId,
    namespaceId: namespace._id,
    status: { $in: ["published", "superseded"] },
  });
  if (!revision) throw new AppError("NamespaceRevision autorizzata non disponibile", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_UNAVAILABLE" }]);
  return revision;
}

async function forkItem({ sourceItemId, sourceEditionId, ownerType, ownerId, contentSpaceId, actorUserId }) {
  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "item.create" });
  const contentSpace = await assertTargetContentSpace({ contentSpaceId, ownerType, ownerId, actorUserId });

  const sourceItem = await ItemV2.findById(sourceItemId);
  if (!sourceItem) throw new AppError("Item sorgente non trovato", 404);
  const sourceEdition = await ItemEdition.findOne({ _id: sourceEditionId, itemId: sourceItem._id });
  if (!sourceEdition) throw new AppError("ItemEdition sorgente non disponibile", 404);

  const { access: contentAccess } = await assertCanForkItemEdition({
    itemEditionId: sourceEdition._id,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });
  if (contentAccess.resolvedSnapshotRef?.resourceType !== "item_revision") {
    throw new AppError("Content fork senza ItemRevision autorizzata", 409, [{ code: "AUTHORIZED_ITEM_REVISION_REQUIRED" }]);
  }
  const sourceRevision = await ItemRevisionV2.findOne({
    _id: contentAccess.resolvedSnapshotRef.resourceId,
    itemEditionId: sourceEdition._id,
    status: { $in: ["published", "superseded"] },
  });
  if (!sourceRevision) throw new AppError("ItemRevision sorgente autorizzata non disponibile", 409, [{ code: "AUTHORIZED_ITEM_REVISION_UNAVAILABLE" }]);

  const namespace = await Namespace.findById(sourceEdition.namespaceId);
  if (!namespace) throw new AppError("Namespace della Edition sorgente non disponibile", 409);
  const namespaceAccess = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });
  if (namespace.lifecycleStatus !== "active" && namespaceAccess.basis !== "entitlement") {
    throw new AppError("Namespace della Edition sorgente non disponibile", 409);
  }
  const targetNamespaceRevision = namespaceAccess.basis === "entitlement"
    ? await resolveNamespaceRevisionForAuthoring({ namespace, access: namespaceAccess })
    : await resolveNamespaceRevision(namespace, sourceRevision.authoredAgainstNamespaceRevisionId);
  const compatibilityIssues = validatePresentationAgainstNamespace(sourceRevision, targetNamespaceRevision);
  if (compatibilityIssues.length) {
    throw new AppError("La revisione sorgente non e compatibile con la NamespaceRevision autorizzata", 409, [{
      code: "FORK_NAMESPACE_INCOMPATIBLE",
      context: { namespaceRevisionId: targetNamespaceRevision._id, issues: compatibilityIssues },
    }]);
  }

  let forkedItem = null;
  let forkedEdition = null;
  let forkedRevision = null;
  await mongoose.connection.transaction(async (session) => {
    [forkedItem] = await ItemV2.create([{
      primarySubjectId: sourceItem.primarySubjectId,
      ownerType,
      ownerId,
      provenance: { origin: "forked", sourceItemId: sourceItem._id },
      createdBy: actorUserId,
    }], { session });
    await createSpaceMemberships({
      contentSpace,
      item: forkedItem,
      subjectId: sourceItem.primarySubjectId,
      actorUserId,
      session,
    });

    [forkedEdition] = await ItemEdition.create([{
      itemId: forkedItem._id,
      namespaceId: sourceEdition.namespaceId,
      createdBy: actorUserId,
    }], { session });
    const presentation = clonePresentationForFork(sourceRevision);
    const payload = revisionPayload(sourceRevision);
    [forkedRevision] = await ItemRevisionV2.create([{
      itemEditionId: forkedEdition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: targetNamespaceRevision._id,
      ...payload,
      ...presentation,
      provenance: { origin: "forked", sourceRevisionId: sourceRevision._id },
      status: "draft",
      integrity: { status: "needs_review", issues: [] },
      review: {},
      publication: {},
      createdBy: actorUserId,
      updatedBy: actorUserId,
    }], { session });
    forkedEdition.workingRevisionId = forkedRevision._id;
    await forkedEdition.save({ session });

    await recordAdoptionFromAccess({
      access: contentAccess,
      actorUserId,
      action: "content_fork",
      sourceResourceRef: { resourceType: "item_edition", resourceId: sourceEdition._id },
      sourceSnapshotRef: { resourceType: "item_revision", resourceId: sourceRevision._id },
      resultResourceRef: { resourceType: "item", resourceId: forkedItem._id },
      session,
    });
    await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: targetNamespaceRevision._id },
      resultResourceRef: { resourceType: "item_edition", resourceId: forkedEdition._id },
      session,
    });
  });

  return {
    item: forkedItem,
    edition: forkedEdition,
    revision: forkedRevision,
    contentSpace,
  };
}

module.exports = {
  createItem,
  forkItem,
};
