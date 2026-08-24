const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { resolveGenerationSources } = require("./generationSourceV2.service");
const semanticResolver = require("./semanticResolver/semanticResolver.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function clampLimit(value) { return Math.min(40, Math.max(1, Number(value) || 20)); }

function projectSubject(subject, matchSource) {
  return {
    id: subject._id,
    preferredLabel: subject.preferredLabel,
    description: subject.description || "",
    externalIdentities: (subject.externalIdentities || []).map((identity) => ({
      scheme: identity.scheme,
      id: identity.id,
      role: identity.role,
      canonicalId: identity.canonicalId || null,
    })),
    matchSource,
  };
}

function sourceScopedGroundedSubjectIds({ candidates = [], sourceSubjectIds = [], alreadyIncludedIds = [] }) {
  const sourceIds = new Set(sourceSubjectIds.map(id));
  const included = new Set(alreadyIncludedIds.map(id));
  return uniqueIds(candidates
    .map((candidate) => candidate.alreadyBoundSubject?.id)
    .filter((subjectId) => subjectId && sourceIds.has(id(subjectId)) && !included.has(id(subjectId))));
}

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

async function searchGenerationSubjectsV2({ actorUserId, editorialSources, query = "", locale = "it", limit = 20 }) {
  const resolvedSources = await resolveGenerationSources({ sources: editorialSources, actorUserId });
  const subjectIds = await subjectIdsForResolvedSources(resolvedSources);
  if (!subjectIds.length) return { results: [], resolver: { status: "not_needed", used: false }, warnings: [] };
  const search = String(query || "").trim();
  const resultLimit = clampLimit(limit);
  const filter = { _id: { $in: subjectIds } };
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ preferredLabel: regex }, { description: regex }];
  }
  const subjects = await Subject.find(filter)
    .select("preferredLabel description externalIdentities")
    .sort({ preferredLabel: 1, _id: 1 })
    .limit(resultLimit)
    .lean();
  const localResults = subjects.map((subject) => projectSubject(subject, "local"));
  if (!search || localResults.length >= resultLimit) {
    return { results: localResults, resolver: { status: "not_needed", used: false }, warnings: [] };
  }

  try {
    const external = await semanticResolver.search({
      scheme: "wikidata",
      query: search,
      locale,
      entityKind: "item",
      limit: Math.min(20, resultLimit),
    });
    const groundedIds = sourceScopedGroundedSubjectIds({
      candidates: external.candidates,
      sourceSubjectIds: subjectIds,
      alreadyIncludedIds: localResults.map((entry) => entry.id),
    });
    const groundedSubjects = groundedIds.length
      ? await Subject.find({ _id: { $in: groundedIds } })
        .select("preferredLabel description externalIdentities")
        .sort({ preferredLabel: 1, _id: 1 })
        .lean()
      : [];
    const results = [
      ...localResults,
      ...groundedSubjects.map((subject) => projectSubject(subject, "external_grounded")),
    ].slice(0, resultLimit);
    return {
      results,
      resolver: {
        status: groundedSubjects.length ? "grounded" : "no_source_binding",
        used: true,
        provider: external.provider,
        groundedResultCount: groundedSubjects.length,
      },
      warnings: [],
    };
  } catch (error) {
    if (error?.status !== 503) throw error;
    return {
      results: localResults,
      resolver: { status: "unavailable", used: true, provider: { scheme: "wikidata", label: "Wikidata" } },
      warnings: [{
        code: "SEMANTIC_PROVIDER_UNAVAILABLE",
        message: "Wikidata non e disponibile: la ricerca continua sui Subject locali delle sorgenti selezionate.",
      }],
    };
  }
}

module.exports = {
  subjectIdsForResolvedSources,
  searchGenerationSubjectsV2,
  sourceScopedGroundedSubjectIds,
};
