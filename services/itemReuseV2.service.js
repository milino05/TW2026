const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const {
  normalizeSubjectLabel,
  SUBJECT_LABEL_COLLATION,
} = require("./subject.service");

function id(value) { return String(value?._id || value?.id || value || ""); }

function mediaProjection(media) {
  if (!media) return null;
  const source = media.toObject ? media.toObject() : media;
  return {
    url: source.url,
    originalUrl: source.originalUrl || null,
    altText: source.altText || null,
    mimeType: source.mimeType || null,
    width: source.width || null,
    height: source.height || null,
    source: source.source || null,
    rights: source.rights || null,
  };
}

async function equivalentSubjects(subject) {
  const normalized = normalizeSubjectLabel(subject.preferredLabel);
  if (!normalized) return [subject];
  const matches = await Subject.find({ preferredLabel: subject.preferredLabel })
    .collation(SUBJECT_LABEL_COLLATION)
    .select("preferredLabel description externalIdentities")
    .lean();
  return matches.filter((candidate) => normalizeSubjectLabel(candidate.preferredLabel) === normalized);
}

async function findOwnedItemReuseCandidates({ ownerType, ownerId, subjectId, contentSpaceId = null }) {
  const subject = await Subject.findById(subjectId).select("preferredLabel description externalIdentities").lean();
  if (!subject) return { subject: null, candidates: [] };

  const subjects = await equivalentSubjects(subject);
  const subjectById = new Map(subjects.map((entry) => [id(entry), entry]));
  const subjectIds = subjects.map((entry) => entry._id);
  const items = subjectIds.length
    ? await ItemV2.find({
      primarySubjectId: { $in: subjectIds },
      ownerType,
      ownerId,
      lifecycleStatus: "active",
    }).sort({ updatedAt: -1, _id: -1 }).lean()
    : [];
  if (!items.length) return { subject, candidates: [] };

  const itemIds = items.map((item) => item._id);
  const memberships = await ContentSpaceItemMembership.find({ itemId: { $in: itemIds } })
    .select("itemId contentSpaceId")
    .lean();
  const spaceIds = [...new Set(memberships.map((membership) => id(membership.contentSpaceId)).filter(Boolean))];
  const spaces = spaceIds.length
    ? await ContentSpace.find({ _id: { $in: spaceIds }, lifecycleStatus: "active", ownerType, ownerId }).select("name").lean()
    : [];
  const spaceById = new Map(spaces.map((space) => [id(space), space]));
  const spacesByItem = new Map();
  for (const membership of memberships) {
    const space = spaceById.get(id(membership.contentSpaceId));
    if (!space) continue;
    const key = id(membership.itemId);
    if (!spacesByItem.has(key)) spacesByItem.set(key, []);
    spacesByItem.get(key).push({
      id: space._id,
      name: space.name,
      current: Boolean(contentSpaceId && id(space._id) === id(contentSpaceId)),
    });
  }

  const editionCounts = await ItemEdition.aggregate([
    { $match: { itemId: { $in: itemIds } } },
    { $group: { _id: "$itemId", count: { $sum: 1 } } },
  ]);
  const editionCountByItem = new Map(editionCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));

  const candidates = items.map((item) => {
    const candidateSubject = subjectById.get(id(item.primarySubjectId)) || subject;
    const exactSubject = id(item.primarySubjectId) === id(subject._id);
    const itemSpaces = spacesByItem.get(id(item._id)) || [];
    return {
      id: item._id,
      primarySubjectId: item.primarySubjectId,
      recognitionMedia: mediaProjection(item.recognitionMedia),
      subject: {
        id: candidateSubject._id,
        preferredLabel: candidateSubject.preferredLabel,
        description: candidateSubject.description || "",
        externalIdentities: candidateSubject.externalIdentities || [],
      },
      matchReason: exactSubject ? "exact_subject" : "same_label",
      spaces: itemSpaces,
      alreadyInCurrentSpace: itemSpaces.some((space) => space.current),
      editionCount: editionCountByItem.get(id(item._id)) || 0,
      updatedAt: item.updatedAt,
    };
  }).sort((a, b) => {
    if (a.matchReason !== b.matchReason) return a.matchReason === "exact_subject" ? -1 : 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  return { subject, candidates };
}

function reuseConflictCandidates(candidates = []) {
  return candidates.map((candidate) => ({
    itemId: candidate.id,
    subjectId: candidate.subject?.id || candidate.primarySubjectId,
    subjectLabel: candidate.subject?.preferredLabel || null,
    matchReason: candidate.matchReason,
    alreadyInCurrentSpace: candidate.alreadyInCurrentSpace,
    editionCount: candidate.editionCount,
  }));
}

module.exports = {
  findOwnedItemReuseCandidates,
  reuseConflictCandidates,
};
