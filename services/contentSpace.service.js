const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { normalizeContentSpacePayload, validateContentSpacePayload } = require("./validation/contentSpace.validation");

async function findContentSpaceOrFail({ contentSpaceId, includeTrashed = false }) {
  const query = { _id: contentSpaceId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const contentSpace = await ContentSpace.findOne(query);
  if (!contentSpace) throw new AppError("ContentSpace non trovato", 404);
  return contentSpace;
}

async function assertCanManageContentSpace(contentSpace, actorUserId, minimumOrganizationRole = "operator") {
  return assertCanActForOwner({
    actorUserId,
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    minimumOrganizationRole,
  });
}

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizeContentSpacePayload(rawPayload || {});
  const issues = validateContentSpacePayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload ContentSpace non valido", 400, issues);
  return normalized;
}

async function createContentSpace({ payload, actorUserId }) {
  const normalized = validateMetadata(payload || {}, { creating: true });
  await assertCanActForOwner({
    actorUserId,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    minimumOrganizationRole: "operator",
  });
  return ContentSpace.create({
    name: normalized.name,
    description: normalized.description ?? null,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    createdBy: actorUserId,
  });
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

async function listContentSpaces({ ownerType = null, ownerId = null } = {}) {
  if (ownerType && !["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400);
  if (ownerId && !mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400);
  const query = { lifecycleStatus: "active" };
  if (ownerType) query.ownerType = ownerType;
  if (ownerId) query.ownerId = ownerId;
  return ContentSpace.find(query).sort({ name: 1, createdAt: 1 });
}

async function getContentSpace({ contentSpaceId }) {
  return findContentSpaceOrFail({ contentSpaceId });
}

async function addItemMembership({ contentSpaceId, itemId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const item = await ItemV2.findOne({ _id: itemId, lifecycleStatus: "active" });
  if (!item) throw new AppError("Item non trovato", 404);
  try {
    return await ContentSpaceMembership.create({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: actorUserId });
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Item gia presente nel ContentSpace", 409);
    throw error;
  }
}

async function removeItemMembership({ contentSpaceId, itemId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const result = await ContentSpaceMembership.deleteOne({ contentSpaceId: contentSpace._id, itemId });
  if (result.deletedCount !== 1) throw new AppError("Membership non trovata", 404);
  return { removed: true };
}

async function moveItemMembership({ fromContentSpaceId, toContentSpaceId, itemId, actorUserId }) {
  if (String(fromContentSpaceId) === String(toContentSpaceId)) {
    throw new AppError("ContentSpace sorgente e destinazione devono essere diversi", 400);
  }
  const [fromSpace, toSpace] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId: fromContentSpaceId }),
    findContentSpaceOrFail({ contentSpaceId: toContentSpaceId }),
  ]);
  await assertCanManageContentSpace(fromSpace, actorUserId);
  await assertCanManageContentSpace(toSpace, actorUserId);
  const sourceMembership = await ContentSpaceMembership.findOne({ contentSpaceId: fromSpace._id, itemId });
  if (!sourceMembership) throw new AppError("Membership sorgente non trovata", 404);
  let targetMembership;
  try {
    targetMembership = await ContentSpaceMembership.create({ contentSpaceId: toSpace._id, itemId, addedBy: actorUserId });
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Item gia presente nel ContentSpace di destinazione", 409);
    throw error;
  }
  const deletion = await ContentSpaceMembership.deleteOne({ _id: sourceMembership._id });
  if (deletion.deletedCount !== 1) {
    await ContentSpaceMembership.deleteOne({ _id: targetMembership._id }).catch(() => {});
    throw new AppError("Spostamento membership fallito", 500);
  }
  return targetMembership;
}

async function listItemMemberships({ contentSpaceId, page = 1, limit = 50 }) {
  await findContentSpaceOrFail({ contentSpaceId });
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const query = { contentSpaceId };
  const [total, memberships] = await Promise.all([
    ContentSpaceMembership.countDocuments(query),
    ContentSpaceMembership.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const itemIds = memberships.map((entry) => entry.itemId);
  const items = await ItemV2.find({ _id: { $in: itemIds } }).lean();
  const itemById = new Map(items.map((item) => [String(item._id), item]));
  return {
    results: memberships.map((membership) => ({ membership, item: itemById.get(String(membership.itemId)) || null })),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
  };
}

module.exports = {
  findContentSpaceOrFail,
  assertCanManageContentSpace,
  createContentSpace,
  updateContentSpace,
  listContentSpaces,
  getContentSpace,
  addItemMembership,
  removeItemMembership,
  moveItemMembership,
  listItemMemberships,
};
