const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const {
  getEditorialContextGraphNeighborhood,
} = require("./editorialContextGraph.service");

function id(value) { return String(value?._id || value || ""); }

function isMissingGraphSubject(error) {
  return error?.status === 404
    && Array.isArray(error?.details)
    && error.details.some((entry) => entry?.code === "GRAPH_SUBJECT_NOT_FOUND");
}

async function implicitCollectionFocus({ editorialContextId, focusSubjectId, base }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).select("contentSpaceId").lean();
  if (!context) return null;

  const memberships = await CollectionItemMembership.find({ editorialContextId: context._id }).select("itemId").lean();
  if (!memberships.length) return null;
  const collectionItemIds = memberships.map((entry) => entry.itemId);
  const collectionItems = await ItemV2.find({
    _id: { $in: collectionItemIds },
    primarySubjectId: focusSubjectId,
    lifecycleStatus: "active",
  }).select("_id").lean();
  if (!collectionItems.length) return null;

  const subject = await Subject.findById(focusSubjectId).select("preferredLabel description externalIdentities").lean();
  if (!subject) return null;

  const allItems = await ItemV2.find({ primarySubjectId: focusSubjectId, lifecycleStatus: "active" }).select("_id").lean();
  const allItemIds = allItems.map((entry) => entry._id);
  const contentSpaceItemCount = allItemIds.length
    ? await ContentSpaceItemMembership.countDocuments({ contentSpaceId: context.contentSpaceId, itemId: { $in: allItemIds } })
    : 0;
  const graphSubjectCount = Number(base?.neighborhood?.totalSubjects || 0);

  return {
    ...base,
    subjects: [{
      subject,
      inGraph: false,
      subjectClassDefinitionIds: [],
      relationCount: 0,
      implicitFromCollection: true,
      presentationCoverage: {
        collectionItemCount: collectionItems.length,
        contentSpaceItemCount,
        artaroundItemCount: allItems.length,
      },
    }],
    edges: [],
    neighborhood: {
      ...(base?.neighborhood || {}),
      focusSubjectId,
      totalSubjects: graphSubjectCount + 1,
      totalNeighbors: 0,
      visibleNeighbors: 0,
      hiddenNeighbors: 0,
      implicitFocus: true,
      virtualFocus: true,
    },
  };
}

async function getEditorialCollectionGraphNeighborhood({
  editorialContextId,
  view = "working",
  actorUserId,
  focusSubjectId = null,
  limit = 18,
}) {
  let base = null;
  let missingGraphSubjectError = null;
  try {
    base = await getEditorialContextGraphNeighborhood({ editorialContextId, view, actorUserId, focusSubjectId, limit });
  } catch (error) {
    if (!isMissingGraphSubject(error) || view !== "working" || !focusSubjectId) throw error;
    missingGraphSubjectError = error;
    base = await getEditorialContextGraphNeighborhood({ editorialContextId, view, actorUserId, focusSubjectId: null, limit });
  }

  if (view !== "working" || !focusSubjectId || id(base?.neighborhood?.focusSubjectId) === id(focusSubjectId)) return base;

  const implicit = await implicitCollectionFocus({ editorialContextId, focusSubjectId, base });
  if (implicit) return implicit;
  if (missingGraphSubjectError) throw missingGraphSubjectError;
  return base;
}

module.exports = { getEditorialCollectionGraphNeighborhood };
