const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const OrganizationMembership = require("../models/organizationMembership.model");
const { normalizeContentSpacePayload, validateContentSpacePayload } = require("./validation/contentSpace.validation");

function id(value) { return String(value?._id || value || ""); }

async function findContentSpaceOrFail({ contentSpaceId, includeTrashed = false }) {
  const query = { _id: contentSpaceId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const contentSpace = await ContentSpace.findOne(query);
  if (!contentSpace) throw new AppError("ContentSpace non trovato", 404);
  return contentSpace;
}

async function assertCanManageContentSpace(contentSpace, actorUserId, permissionCode = "editorial_space.manage") {
  return assertCanActForOwner({ actorUserId, ownerType: contentSpace.ownerType, ownerId: contentSpace.ownerId, permissionCode });
}

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizeContentSpacePayload(rawPayload || {});
  const issues = validateContentSpacePayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload ContentSpace non valido", 400, issues);
  return normalized;
}

async function createContentSpace({ payload, actorUserId }) {
  const normalized = validateMetadata(payload || {}, { creating: true });
  await assertCanActForOwner({ actorUserId, ownerType: normalized.ownerType, ownerId: normalized.ownerId, permissionCode: "editorial_space.manage" });
  return ContentSpace.create({ name: normalized.name, description: normalized.description ?? null, ownerType: normalized.ownerType, ownerId: normalized.ownerId, createdBy: actorUserId });
}

async function updateContentSpace({ contentSpaceId, payload, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const normalized = validateMetadata(payload || {}, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "name")) contentSpace.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) contentSpace.description = normalized.description ?? null;
  await contentSpace.save();
  return contentSpace;
}

async function ownedItemsWithoutAlternativeSpace({ contentSpace, itemIds }) {
  if (!itemIds.length) return [];
  const ownedItems = await ItemV2.find({
    _id: { $in: itemIds },
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    lifecycleStatus: "active",
  }).select("_id").lean();
  if (!ownedItems.length) return [];
  const ownedIds = ownedItems.map((item) => item._id);
  const alternatives = await ContentSpaceItemMembership.find({
    itemId: { $in: ownedIds },
    contentSpaceId: { $ne: contentSpace._id },
  }).select("itemId contentSpaceId").lean();
  if (!alternatives.length) return ownedIds;
  const activeSpaces = await ContentSpace.find({
    _id: { $in: alternatives.map((membership) => membership.contentSpaceId) },
    lifecycleStatus: "active",
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
  }).select("_id").lean();
  const activeSpaceIds = new Set(activeSpaces.map((space) => id(space._id)));
  const coveredItemIds = new Set(alternatives
    .filter((membership) => activeSpaceIds.has(id(membership.contentSpaceId)))
    .map((membership) => id(membership.itemId)));
  return ownedIds.filter((itemId) => !coveredItemIds.has(id(itemId)));
}

async function trashContentSpace({ contentSpaceId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.manage");
  const activeContexts = await EditorialContext.find({ contentSpaceId: contentSpace._id, lifecycleStatus: "active" }).select("_id displayName").lean();
  if (activeContexts.length) {
    throw new AppError("Lo spazio contiene ancora raccolte editoriali attive", 409, [{
      code: "CONTENT_SPACE_HAS_ACTIVE_COLLECTIONS",
      field: "contentSpaceId",
      context: {
        collectionCount: activeContexts.length,
        collections: activeContexts.slice(0, 20).map((entry) => ({ id: entry._id, name: entry.displayName })),
      },
    }]);
  }
  const itemMemberships = await ContentSpaceItemMembership.find({ contentSpaceId: contentSpace._id }).select("itemId").lean();
  const orphanedOwnedItemIds = await ownedItemsWithoutAlternativeSpace({
    contentSpace,
    itemIds: itemMemberships.map((membership) => membership.itemId),
  });
  if (orphanedOwnedItemIds.length) {
    throw new AppError("Sposta prima i contenuti posseduti che rimarrebbero senza uno spazio editoriale", 409, [{
      code: "CONTENT_SPACE_OWNED_ITEMS_WOULD_BECOME_UNSCOPED",
      field: "contentSpaceId",
      context: { itemIds: orphanedOwnedItemIds.slice(0, 50), itemCount: orphanedOwnedItemIds.length },
    }]);
  }
  const now = new Date();
  await mongoose.connection.transaction(async (session) => {
    await Promise.all([
      ContentSpaceItemMembership.deleteMany({ contentSpaceId: contentSpace._id }, { session }),
      ContentSpaceSubjectMembership.deleteMany({ contentSpaceId: contentSpace._id }, { session }),
    ]);
    const result = await ContentSpace.updateOne(
      { _id: contentSpace._id, lifecycleStatus: "active" },
      { $set: { lifecycleStatus: "trashed", trashedAt: now, trashedBy: actorUserId } },
      { session },
    );
    if (result.modifiedCount !== 1) throw new AppError("Lo spazio editoriale è stato modificato da un'altra operazione", 409, [{ code: "CONTENT_SPACE_LIFECYCLE_CONFLICT" }]);
  });
  return { contentSpaceId: contentSpace._id, lifecycleStatus: "trashed", removedMemberships: true, removedAt: now };
}

async function listContentSpaces({ actorUserId, ownerType = null, ownerId = null } = {}) {
  const user = await getActiveUserOrFail(actorUserId);
  if ((ownerType && !ownerId) || (!ownerType && ownerId)) throw new AppError("ownerType e ownerId devono essere specificati insieme", 400);
  const query = { lifecycleStatus: "active" };
  if (ownerType && ownerId) {
    if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400);
    if (!mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400);
    await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_space.view" });
    query.ownerType = ownerType;
    query.ownerId = ownerId;
  } else {
    const memberships = await OrganizationMembership.find({ userId: user._id }).select("organizationId").lean();
    const organizationIds = memberships.map((membership) => membership.organizationId);
    query.$or = [
      { ownerType: "user", ownerId: user._id },
      { ownerType: "organization", ownerId: { $in: organizationIds } },
    ];
  }
  return ContentSpace.find(query).sort({ name: 1, createdAt: 1 });
}

async function getContentSpace({ contentSpaceId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.view");
  const [itemCount, subjectCount, collectionCount] = await Promise.all([
    ContentSpaceItemMembership.countDocuments({ contentSpaceId: contentSpace._id }),
    ContentSpaceSubjectMembership.countDocuments({ contentSpaceId: contentSpace._id }),
    EditorialContext.countDocuments({ contentSpaceId: contentSpace._id, lifecycleStatus: "active" }),
  ]);
  return { ...contentSpace.toObject(), counts: { items: itemCount, subjects: subjectCount, collections: collectionCount } };
}

async function ensureSubjectMembership({ contentSpaceId, subjectId, actorUserId, session = null }) {
  const options = session ? { session } : undefined;
  return ContentSpaceSubjectMembership.findOneAndUpdate(
    { contentSpaceId, subjectId },
    { $setOnInsert: { contentSpaceId, subjectId, addedBy: actorUserId } },
    { upsert: true, new: true, ...options },
  );
}

async function addItemMembership({ contentSpaceId, itemId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const item = await ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item non trovato", 404);
  if (item.ownerType !== contentSpace.ownerType || id(item.ownerId) !== id(contentSpace.ownerId)) {
    throw new AppError("Usa il flusso di acquisizione per aggiungere contenuti appartenenti a un altro titolare", 403, [{ code: "CONTENT_SPACE_ITEM_OWNER_MISMATCH" }]);
  }
  let membership = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      await ensureSubjectMembership({ contentSpaceId: contentSpace._id, subjectId: item.primarySubjectId, actorUserId, session });
      [membership] = await ContentSpaceItemMembership.create([{
        contentSpaceId: contentSpace._id,
        itemId: item._id,
        addedBy: actorUserId,
      }], { session });
    });
    return membership;
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Item gia presente nel ContentSpace", 409);
    throw error;
  }
}

async function assertItemNotUsedByActiveEditorialContext({ contentSpaceId, itemId }) {
  const contexts = await EditorialContext.find({ contentSpaceId, lifecycleStatus: "active" }).select("_id displayName").lean();
  if (!contexts.length) return;
  const membership = await CollectionItemMembership.findOne({
    editorialContextId: { $in: contexts.map((context) => context._id) },
    itemId,
  }).select("editorialContextId").lean();
  if (!membership) return;
  const context = contexts.find((candidate) => id(candidate._id) === id(membership.editorialContextId));
  throw new AppError("Rimuovi prima il contenuto dalle raccolte editoriali che lo usano", 409, [{
    code: "ITEM_USED_BY_EDITORIAL_CONTEXT",
    field: "itemId",
    context: { editorialContextId: membership.editorialContextId, editorialContextName: context?.displayName || null },
  }]);
}

async function removeItemMembership({ contentSpaceId, itemId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  await assertItemNotUsedByActiveEditorialContext({ contentSpaceId: contentSpace._id, itemId });
  const item = await ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" }).select("ownerType ownerId").lean();
  if (item && item.ownerType === contentSpace.ownerType && id(item.ownerId) === id(contentSpace.ownerId)) {
    const orphaned = await ownedItemsWithoutAlternativeSpace({ contentSpace, itemIds: [item._id] });
    if (orphaned.length) {
      throw new AppError("Un contenuto posseduto deve appartenere ad almeno uno spazio editoriale attivo", 409, [{ code: "OWNED_ITEM_REQUIRES_CONTENT_SPACE", field: "itemId" }]);
    }
  }
  const result = await ContentSpaceItemMembership.deleteOne({ contentSpaceId: contentSpace._id, itemId });
  if (result.deletedCount !== 1) throw new AppError("Membership non trovata", 404);
  return { removed: true };
}

async function moveItemMembership({ fromContentSpaceId, toContentSpaceId, itemId, actorUserId }) {
  if (!mongoose.isValidObjectId(toContentSpaceId)) throw new AppError("targetContentSpaceId non valido", 400);
  if (id(fromContentSpaceId) === id(toContentSpaceId)) throw new AppError("ContentSpace sorgente e destinazione devono essere diversi", 400);
  const [fromSpace, toSpace, item] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId: fromContentSpaceId }),
    findContentSpaceOrFail({ contentSpaceId: toContentSpaceId }),
    ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" }),
  ]);
  await assertCanManageContentSpace(fromSpace, actorUserId);
  await assertCanManageContentSpace(toSpace, actorUserId);
  if (!item) throw new AppError("Item non trovato", 404);
  if (item.ownerType !== toSpace.ownerType || id(item.ownerId) !== id(toSpace.ownerId)) {
    throw new AppError("Lo spostamento diretto è consentito solo fra spazi del titolare del contenuto", 403, [{ code: "CONTENT_SPACE_ITEM_OWNER_MISMATCH" }]);
  }
  const sourceMembership = await ContentSpaceItemMembership.findOne({ contentSpaceId: fromSpace._id, itemId });
  if (!sourceMembership) throw new AppError("Membership sorgente non trovata", 404);
  await assertItemNotUsedByActiveEditorialContext({ contentSpaceId: fromSpace._id, itemId });
  let targetMembership = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      await ensureSubjectMembership({ contentSpaceId: toSpace._id, subjectId: item.primarySubjectId, actorUserId, session });
      [targetMembership] = await ContentSpaceItemMembership.create([{
        contentSpaceId: toSpace._id,
        itemId,
        addedBy: actorUserId,
      }], { session });
      const deletion = await ContentSpaceItemMembership.deleteOne({ _id: sourceMembership._id }, { session });
      if (deletion.deletedCount !== 1) throw new AppError("Spostamento membership fallito", 409, [{ code: "CONTENT_SPACE_MEMBERSHIP_MOVE_CONFLICT" }]);
    });
    return targetMembership;
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Item gia presente nel ContentSpace di destinazione", 409);
    throw error;
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listItemMemberships({ contentSpaceId, actorUserId, page = 1, limit = 50, q = "" }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.view");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const normalizedQuery = String(q || "").trim().slice(0, 160);
  const pipeline = [
    { $match: { contentSpaceId: contentSpace._id } },
    { $lookup: { from: ItemV2.collection.name, localField: "itemId", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $match: { "item.lifecycleStatus": "active" } },
    { $lookup: { from: Subject.collection.name, localField: "item.primarySubjectId", foreignField: "_id", as: "subject" } },
    { $unwind: { path: "$subject", preserveNullAndEmptyArrays: true } },
  ];
  if (normalizedQuery) {
    const pattern = new RegExp(escapeRegex(normalizedQuery), "i");
    const searchClauses = [
      { "subject.preferredLabel": pattern },
      { "subject.description": pattern },
    ];
    if (mongoose.isValidObjectId(normalizedQuery)) searchClauses.push({ "item._id": new mongoose.Types.ObjectId(normalizedQuery) });
    pipeline.push({ $match: { $or: searchClauses } });
  }
  pipeline.push(
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        results: [
          { $skip: (normalizedPage - 1) * normalizedLimit },
          { $limit: normalizedLimit },
          {
            $project: {
              _id: 0,
              itemId: "$item._id",
              lifecycleStatus: "$item.lifecycleStatus",
              addedAt: "$createdAt",
              updatedAt: "$item.updatedAt",
              subject: {
                id: "$subject._id",
                label: { $ifNull: ["$subject.preferredLabel", "Soggetto non disponibile"] },
                description: { $ifNull: ["$subject.description", ""] },
              },
            },
          },
        ],
      },
    },
  );
  const [projection = { metadata: [], results: [] }] = await ContentSpaceItemMembership.aggregate(pipeline);
  const results = projection.results || [];
  const itemIds = results.map((entry) => entry.itemId);
  const editions = itemIds.length
    ? await ItemEdition.find({ itemId: { $in: itemIds } }).select("_id itemId").lean()
    : [];
  const editionCountByItem = new Map();
  for (const edition of editions) {
    const itemKey = id(edition.itemId);
    editionCountByItem.set(itemKey, (editionCountByItem.get(itemKey) || 0) + 1);
  }
  const activeContexts = itemIds.length
    ? await EditorialContext.find({ contentSpaceId: contentSpace._id, lifecycleStatus: "active" }).select("_id").lean()
    : [];
  const collectionMemberships = itemIds.length && activeContexts.length
    ? await CollectionItemMembership.find({
      editorialContextId: { $in: activeContexts.map((context) => context._id) },
      itemId: { $in: itemIds },
    }).select("editorialContextId itemId").lean()
    : [];
  const collectionIdsByItem = new Map();
  for (const membership of collectionMemberships) {
    const itemKey = id(membership.itemId);
    if (!collectionIdsByItem.has(itemKey)) collectionIdsByItem.set(itemKey, new Set());
    collectionIdsByItem.get(itemKey).add(id(membership.editorialContextId));
  }
  const total = projection.metadata?.[0]?.total || 0;
  return {
    results: results.map((entry) => ({
      ...entry,
      editionCount: editionCountByItem.get(id(entry.itemId)) || 0,
      collectionUsageCount: collectionIdsByItem.get(id(entry.itemId))?.size || 0,
    })),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
  };
}

module.exports = {
  findContentSpaceOrFail,
  assertCanManageContentSpace,
  createContentSpace,
  updateContentSpace,
  trashContentSpace,
  listContentSpaces,
  getContentSpace,
  ensureSubjectMembership,
  addItemMembership,
  assertItemNotUsedByActiveEditorialContext,
  removeItemMembership,
  moveItemMembership,
  listItemMemberships,
};