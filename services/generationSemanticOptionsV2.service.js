const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { resolveGenerationSources } = require("./generationSourceV2.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function clampLimit(value) { return Math.min(40, Math.max(1, Number(value) || 20)); }

async function subjectIdsForResolvedSources(resolvedSources) {
  const releases = resolvedSources.map((entry) => entry.editorialRelease);
  const graphRevisionIds = uniqueIds(releases.map((release) => release.graphRevisionId));
  const graphBindings = graphRevisionIds.length
    ? await GraphSubjectBinding.find({ graphRevisionId: { $in: graphRevisionIds } }).select("subjectId").lean()
    : [];

  const itemBindings = releases.flatMap((release) => release.itemBindings || []);
  const editionIds = uniqueIds(itemBindings.map((binding) => binding.itemEditionId));
  const revisionIds = uniqueIds(itemBindings.map((binding) => binding.itemRevisionId));
  const [editions, revisions] = await Promise.all([
    editionIds.length ? ItemEdition.find({ _id: { $in: editionIds } }).select("_id itemId").lean() : [],
    revisionIds.length
      ? ItemRevisionV2.find({ _id: { $in: revisionIds } })
        .select("relatedSubjectIds presentationVariants.semanticFocus presentationVariants.knowledgeRequirements")
        .lean()
      : [],
  ]);
  const itemIds = uniqueIds(editions.map((edition) => edition.itemId));
  const items = itemIds.length
    ? await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("primarySubjectId").lean()
    : [];

  return uniqueIds([
    ...graphBindings.map((binding) => binding.subjectId),
    ...items.map((item) => item.primarySubjectId),
    ...revisions.flatMap((revision) => [
      ...(revision.relatedSubjectIds || []),
      ...(revision.presentationVariants || []).flatMap((variant) => [
        ...(variant.semanticFocus || []).map((entry) => entry.subjectId),
        ...(variant.knowledgeRequirements || []).map((entry) => entry.subjectId),
      ]),
    ]),
  ]);
}

async function searchGenerationSubjectsV2({ actorUserId, editorialSources, query = "", limit = 20 }) {
  const resolvedSources = await resolveGenerationSources({ sources: editorialSources, actorUserId });
  const subjectIds = await subjectIdsForResolvedSources(resolvedSources);
  if (!subjectIds.length) return { results: [] };
  const search = String(query || "").trim();
  const filter = { _id: { $in: subjectIds } };
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ preferredLabel: regex }, { description: regex }];
  }
  const subjects = await Subject.find(filter)
    .select("preferredLabel description externalRefs")
    .sort({ preferredLabel: 1, _id: 1 })
    .limit(clampLimit(limit))
    .lean();
  return {
    results: subjects.map((subject) => ({
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalRefs: (subject.externalRefs || []).map((ref) => ({ scheme: ref.scheme, id: ref.id })),
    })),
  };
}

module.exports = {
  subjectIdsForResolvedSources,
  searchGenerationSubjectsV2,
};
