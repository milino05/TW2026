const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function loadContextAndSpace({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  return { context, contentSpace };
}

async function listEditorialCollectionAvailableItems({ editorialContextId, actorUserId, query = "", page = 1, limit = 30 }) {
  const { context, contentSpace } = await loadContextAndSpace({ editorialContextId, actorUserId });
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
  const normalizedQuery = String(query || "").trim().slice(0, 160);

  const [spaceItemIds, existingEntries] = await Promise.all([
    ContentSpaceItemMembership.distinct("itemId", { contentSpaceId: contentSpace._id }),
    CollectionItemMembership.find({ editorialContextId: context._id }).select("itemId").lean(),
  ]);
  const existingItemIds = new Set(existingEntries.map((entry) => id(entry.itemId)));
  let candidateItemIds = spaceItemIds.filter((itemId) => !existingItemIds.has(id(itemId)));
  let candidateItems = candidateItemIds.length
    ? await ItemV2.find({ _id: { $in: candidateItemIds }, lifecycleStatus: "active" }).select("_id ownerType ownerId primarySubjectId").lean()
    : [];
  let candidateEditions = candidateItems.length
    ? await ItemEdition.find({ itemId: { $in: candidateItems.map((item) => item._id) }, namespaceId: context.namespaceId }).lean()
    : [];

  if (normalizedQuery && candidateItems.length) {
    const regex = new RegExp(escapeRegex(normalizedQuery), "i");
    const candidateSubjectIds = [...new Set(candidateItems.map((item) => id(item.primarySubjectId)).filter(Boolean))];
    const candidateEditionIds = candidateEditions.map((edition) => edition._id);
    const [matchingSubjects, matchingRevisions] = await Promise.all([
      candidateSubjectIds.length
        ? Subject.find({ _id: { $in: candidateSubjectIds }, $or: [{ preferredLabel: regex }, { description: regex }] }).select("_id").lean()
        : [],
      candidateEditionIds.length
        ? ItemRevisionV2.find({ itemEditionId: { $in: candidateEditionIds }, label: regex }).select("itemEditionId").lean()
        : [],
    ]);
    const matchingSubjectIds = new Set(matchingSubjects.map((entry) => id(entry._id)));
    const matchingEditionIds = new Set(matchingRevisions.map((entry) => id(entry.itemEditionId)));
    const matchingItemIds = new Set([
      ...candidateItems.filter((item) => matchingSubjectIds.has(id(item.primarySubjectId))).map((item) => id(item._id)),
      ...candidateEditions.filter((edition) => matchingEditionIds.has(id(edition._id))).map((edition) => id(edition.itemId)),
    ]);
    candidateItemIds = candidateItemIds.filter((itemId) => matchingItemIds.has(id(itemId)));
    candidateItems = candidateItems.filter((item) => matchingItemIds.has(id(item._id)));
    candidateEditions = candidateEditions.filter((edition) => matchingItemIds.has(id(edition.itemId)));
  }

  const editionByItemId = new Map(candidateEditions.map((edition) => [id(edition.itemId), edition]));
  const usableEditionIds = new Set();
  await Promise.all(candidateEditions.map(async (edition) => {
    try {
      await assertCanUseItemEditionForEditorialRelease({
        itemEditionId: edition._id,
        actorUserId,
        principalType: contentSpace.ownerType,
        principalId: contentSpace.ownerId,
      });
      usableEditionIds.add(id(edition._id));
    } catch (error) {
      if (![403, 404, 409].includes(error?.status)) throw error;
    }
  }));

  const authorizedItemIds = new Set(candidateItems
    .filter((item) => {
      const owned = item.ownerType === contentSpace.ownerType && id(item.ownerId) === id(contentSpace.ownerId);
      const edition = editionByItemId.get(id(item._id));
      return owned || Boolean(edition && usableEditionIds.has(id(edition._id)));
    })
    .map((item) => id(item._id)));
  candidateItemIds = candidateItemIds.filter((itemId) => authorizedItemIds.has(id(itemId)));

  const membershipQuery = { contentSpaceId: contentSpace._id, itemId: { $in: candidateItemIds } };
  const [total, memberships] = await Promise.all([
    ContentSpaceItemMembership.countDocuments(membershipQuery),
    ContentSpaceItemMembership.find(membershipQuery)
      .sort({ createdAt: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const pageItemIds = memberships.map((entry) => entry.itemId);
  const items = pageItemIds.length
    ? await ItemV2.find({ _id: { $in: pageItemIds }, lifecycleStatus: "active" }).lean()
    : [];
  const itemById = new Map(items.map((item) => [id(item._id), item]));
  const pageEditions = pageItemIds.length
    ? await ItemEdition.find({ itemId: { $in: pageItemIds }, namespaceId: context.namespaceId }).lean()
    : [];
  const pageEditionByItemId = new Map(pageEditions.map((edition) => [id(edition.itemId), edition]));
  const revisionIds = pageEditions.map((edition) => edition.workingRevisionId || edition.publishedRevisionId).filter(Boolean);
  const subjectIds = items.map((item) => item.primarySubjectId).filter(Boolean);
  const [revisions, subjects] = await Promise.all([
    revisionIds.length ? ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label status version").lean() : [],
    subjectIds.length ? Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description").lean() : [],
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));

  return {
    context: { id: context._id, name: context.displayName },
    contentSpace: { id: contentSpace._id, name: contentSpace.name },
    results: memberships.map((membership) => {
      const item = itemById.get(id(membership.itemId));
      if (!item) return null;
      const edition = pageEditionByItemId.get(id(item._id)) || null;
      const revision = edition ? revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null : null;
      const subject = subjectById.get(id(item.primarySubjectId)) || null;
      return {
        itemId: item._id,
        itemEditionId: edition?._id || null,
        compatibleEdition: Boolean(edition),
        releaseUsable: Boolean(edition && usableEditionIds.has(id(edition._id))),
        subject: subject ? { id: subject._id, label: subject.preferredLabel, description: subject.description || "" } : null,
        revision: revision ? { id: revision._id, label: revision.label, status: revision.status, version: revision.version } : null,
      };
    }).filter(Boolean),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
  };
}

module.exports = { listEditorialCollectionAvailableItems };
