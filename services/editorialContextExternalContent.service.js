const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const Entitlement = require("../models/entitlement.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function objectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
  return new mongoose.Types.ObjectId(String(value));
}
function workingConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}

async function loadImportContext({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  if (context.activeReviewRevisionId) {
    throw new AppError("La raccolta è bloccata mentre una revisione è attiva", 409, [{ code: "EDITORIAL_CONTEXT_REVIEW_LOCKED" }]);
  }
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await Promise.all([
    assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.edit"),
    assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.manage"),
  ]);
  return { context, contentSpace };
}

function activeEntitlementExpression(now) {
  return {
    $and: [
      { $eq: ["$status", "active"] },
      { $lte: ["$validFrom", now] },
      { $or: [{ $eq: ["$validUntil", null] }, { $gt: ["$validUntil", now] }] },
    ],
  };
}

async function searchExternalEditorialCandidates({ editorialContextId, actorUserId, query = "", page = 1, limit = 12 }) {
  const { context, contentSpace } = await loadImportContext({ editorialContextId, actorUserId });
  const normalizedQuery = String(query || "").trim().slice(0, 160);
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  if (normalizedQuery.length < 2) {
    return {
      results: [],
      pagination: { page: normalizedPage, limit: normalizedLimit, total: 0, totalPages: 0 },
      query: normalizedQuery,
      requiresQuery: true,
    };
  }

  const now = new Date();
  const pattern = new RegExp(escapeRegex(normalizedQuery), "i");
  const pipeline = [
    { $match: { namespaceId: context.namespaceId } },
    { $lookup: { from: ItemV2.collection.name, localField: "itemId", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $match: { "item.lifecycleStatus": "active" } },
    { $addFields: { displayRevisionId: { $ifNull: ["$publishedRevisionId", "$workingRevisionId"] } } },
    { $lookup: { from: ItemRevisionV2.collection.name, localField: "displayRevisionId", foreignField: "_id", as: "displayRevision" } },
    { $unwind: { path: "$displayRevision", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: Subject.collection.name, localField: "item.primarySubjectId", foreignField: "_id", as: "subject" } },
    { $unwind: { path: "$subject", preserveNullAndEmptyArrays: true } },
    { $match: { $or: [
      { "displayRevision.label": pattern },
      { "subject.preferredLabel": pattern },
      { "subject.description": pattern },
    ] } },
    { $lookup: {
      from: ContentSpaceItemMembership.collection.name,
      let: { candidateItemId: "$item._id" },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ["$contentSpaceId", contentSpace._id] },
          { $eq: ["$itemId", "$$candidateItemId"] },
        ] } } },
        { $limit: 1 },
      ],
      as: "spaceMembership",
    } },
    { $match: { spaceMembership: { $size: 0 } } },
    { $lookup: {
      from: ItemRevisionV2.collection.name,
      let: { candidateEditionId: "$_id" },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ["$itemEditionId", "$$candidateEditionId"] },
          { $in: ["$status", ["published", "superseded"]] },
        ] } } },
        { $project: { _id: 1 } },
      ],
      as: "publishedSnapshots",
    } },
    { $lookup: {
      from: Entitlement.collection.name,
      let: { candidateEditionId: "$_id", snapshotIds: "$publishedSnapshots._id" },
      pipeline: [
        { $match: { beneficiaryType: contentSpace.ownerType, beneficiaryId: contentSpace.ownerId, capability: "content.use_in_editorial_release" } },
        { $match: { $expr: { $and: [
          activeEntitlementExpression(now),
          { $or: [
            { $and: [{ $eq: ["$resourceType", "item_edition"] }, { $eq: ["$resourceId", "$$candidateEditionId"] }] },
            { $and: [{ $eq: ["$resourceType", "item_revision"] }, { $in: ["$resourceId", "$$snapshotIds"] }] },
          ] },
        ] } } },
        { $limit: 1 },
      ],
      as: "usableEntitlements",
    } },
    { $match: { $or: [
      { "item.ownerType": contentSpace.ownerType, "item.ownerId": contentSpace.ownerId },
      { "usableEntitlements.0": { $exists: true } },
    ] } },
    { $sort: { "displayRevision.updatedAt": -1, updatedAt: -1, _id: -1 } },
    { $facet: {
      metadata: [{ $count: "total" }],
      results: [
        { $skip: (normalizedPage - 1) * normalizedLimit },
        { $limit: normalizedLimit },
        { $project: {
          _id: 1,
          itemId: "$item._id",
          subject: {
            id: "$subject._id",
            label: { $ifNull: ["$subject.preferredLabel", "Soggetto non disponibile"] },
            description: { $ifNull: ["$subject.description", ""] },
          },
          fallbackRevision: {
            id: "$displayRevision._id",
            label: { $ifNull: ["$displayRevision.label", "$subject.preferredLabel"] },
            status: "$displayRevision.status",
            version: "$displayRevision.version",
          },
        } },
      ],
    } },
  ];

  const [projection = { metadata: [], results: [] }] = await ItemEdition.aggregate(pipeline);
  const projected = [];
  for (const candidate of projection.results || []) {
    const access = await assertCanUseItemEditionForEditorialRelease({
      itemEditionId: candidate._id,
      actorUserId,
      principalType: contentSpace.ownerType,
      principalId: contentSpace.ownerId,
    });
    const snapshotId = access.access?.resolvedSnapshotRef?.resourceType === "item_revision"
      ? access.access.resolvedSnapshotRef.resourceId
      : null;
    const revision = snapshotId ? await ItemRevisionV2.findById(snapshotId).select("label status version").lean() : null;
    projected.push({
      itemId: candidate.itemId,
      itemEditionId: candidate._id,
      subject: candidate.subject || null,
      revision: revision ? { id: revision._id, label: revision.label, status: revision.status, version: revision.version } : candidate.fallbackRevision,
      access: { basis: access.access?.basis || null },
    });
  }
  const total = Number(projection.metadata?.[0]?.total || 0);
  return {
    results: projected,
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
    requiresQuery: false,
  };
}

async function importExternalEditorialCandidate({ editorialContextId, itemEditionId, actorUserId }) {
  objectId(editorialContextId, "editorialContextId");
  objectId(itemEditionId, "itemEditionId");
  const { context, contentSpace } = await loadImportContext({ editorialContextId, actorUserId });
  const edition = await ItemEdition.findById(itemEditionId).lean();
  if (!edition) throw new AppError("Versione editoriale non trovata", 404);
  if (id(edition.namespaceId) !== id(context.namespaceId)) {
    throw new AppError("La versione editoriale usa regole diverse dalla raccolta", 409, [{ code: "ITEM_EDITION_NAMESPACE_MISMATCH" }]);
  }
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" }).lean();
  if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE" }]);
  await assertCanUseItemEditionForEditorialRelease({
    itemEditionId: edition._id,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });

  let entry = null;
  let membershipCreated = false;
  try {
    await mongoose.connection.transaction(async (session) => {
      const lockedContext = await EditorialContext.findOne({
        _id: context._id,
        lifecycleStatus: "active",
        activeReviewRevisionId: null,
        workingVersion: Number(context.workingVersion || 0),
      }).session(session);
      if (!lockedContext) throw workingConflict();

      await ContentSpaceSubjectMembership.findOneAndUpdate(
        { contentSpaceId: contentSpace._id, subjectId: item.primarySubjectId },
        { $setOnInsert: { contentSpaceId: contentSpace._id, subjectId: item.primarySubjectId, addedBy: actorUserId } },
        { upsert: true, new: true, session },
      );
      const membership = await ContentSpaceItemMembership.findOne({ contentSpaceId: contentSpace._id, itemId: item._id }).session(session);
      if (!membership) {
        await ContentSpaceItemMembership.create([{
          contentSpaceId: contentSpace._id,
          itemId: item._id,
          addedBy: actorUserId,
        }], { session });
        membershipCreated = true;
      }

      const existing = await CollectionItemMembership.findOne({ editorialContextId: lockedContext._id, itemId: item._id }).session(session);
      if (existing) throw new AppError("Contenuto già presente nella raccolta", 409, [{ code: "COLLECTION_ITEM_MEMBERSHIP_EXISTS" }]);
      [entry] = await CollectionItemMembership.create([{
        editorialContextId: lockedContext._id,
        itemId: item._id,
        curationSignals: [],
        addedBy: actorUserId,
        updatedBy: actorUserId,
      }], { session });
      lockedContext.workingVersion = Number(lockedContext.workingVersion || 0) + 1;
      await lockedContext.save({ session });
    });
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Contenuto già presente nello spazio o nella raccolta", 409, [{ code: "EDITORIAL_IMPORT_CONFLICT" }]);
    throw error;
  }

  return {
    entry,
    contentSpaceId: contentSpace._id,
    itemId: item._id,
    itemEditionId: edition._id,
    membershipCreated,
  };
}

module.exports = {
  searchExternalEditorialCandidates,
  importExternalEditorialCandidate,
};