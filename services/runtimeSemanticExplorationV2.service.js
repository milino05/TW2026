const crypto = require("crypto");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { loadSemanticGraphRevision, neighbors } = require("./semanticGraphV2.service");
const { resolveInitialPresentation, unitPosition } = require("./presentationRuntimeV2.service");

function id(value) { return String(value?._id || value || ""); }
function unique(values) { return [...new Set((values || []).map(id).filter(Boolean))]; }
function opaqueActionId(seed) {
  return `semantic.explore.${crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 20)}`;
}

function semanticDefinition({ seed, label, controlledVoiceAliases = [] }) {
  return {
    actionId: opaqueActionId(seed),
    type: "EXPLORE_SEMANTIC_CONTENT",
    family: "semantic",
    label,
    controlledVoiceAliases: [...new Set((controlledVoiceAliases || []).map((value) => String(value || "").trim()).filter(Boolean))],
  };
}

async function loadPinnedEditorialScope(plan) {
  const releaseIds = unique(plan?.sourceEditorialReleaseIds);
  if (!releaseIds.length) return { releases: [], rows: [], graphByReleaseId: new Map() };

  const releases = await EditorialRelease.find({ _id: { $in: releaseIds } }).lean();
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  for (const releaseId of releaseIds) {
    if (!releaseById.has(releaseId)) {
      throw new AppError("EditorialRelease pinzata dalla Session non disponibile", 409, [{ code: "SESSION_EDITORIAL_SCOPE_UNAVAILABLE" }]);
    }
  }

  const bindingRows = releases.flatMap((release) => (release.itemBindings || []).map((binding) => ({
    release,
    itemEditionId: binding.itemEditionId,
    itemRevisionId: binding.itemRevisionId,
  })));
  const editionIds = unique(bindingRows.map((row) => row.itemEditionId));
  const revisionIds = unique(bindingRows.map((row) => row.itemRevisionId));
  const editions = editionIds.length ? await ItemEdition.find({ _id: { $in: editionIds } }).lean() : [];
  const revisions = revisionIds.length ? await ItemRevisionV2.find({ _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } }).lean() : [];
  const editionById = new Map(editions.map((edition) => [id(edition._id), edition]));
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemIds = unique(editions.map((edition) => edition.itemId));
  const items = itemIds.length ? await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).lean() : [];
  const itemById = new Map(items.map((item) => [id(item._id), item]));

  const rows = [];
  for (const binding of bindingRows) {
    const edition = editionById.get(id(binding.itemEditionId));
    const revision = revisionById.get(id(binding.itemRevisionId));
    const item = edition ? itemById.get(id(edition.itemId)) : null;
    if (!edition || !revision || !item) continue;
    rows.push({
      sourceEditorialReleaseId: binding.release._id,
      namespaceRevisionId: binding.release.namespaceRevisionId,
      itemId: item._id,
      itemEditionId: edition._id,
      itemRevisionId: revision._id,
      subjectId: item.primarySubjectId,
      revision,
    });
  }

  const graphByReleaseId = new Map();
  for (const release of releases) {
    const graph = await loadSemanticGraphRevision(release.graphRevisionId, { namespaceRevisionId: release.namespaceRevisionId });
    graphByReleaseId.set(id(release._id), graph);
  }
  return { releases, rows, graphByReleaseId };
}

function relationVoiceAliases(graph, edge) {
  const definition = (graph?.namespaceRevision?.relationTypes || []).find((entry) =>
    String(entry.definitionId) === String(edge.relationTypeDefinitionId));
  if (!definition) return [];
  return edge.generated ? definition.reverse?.userIntents || [] : definition.userIntents || [];
}

async function resolveCurrentSubjectId({ currentSubjectId = null, currentItemId = null }) {
  if (currentSubjectId) return id(currentSubjectId);
  if (!currentItemId) return null;
  const item = await ItemV2.findOne({ _id: currentItemId, lifecycleStatus: "active" }).select("primarySubjectId").lean();
  return item ? id(item.primarySubjectId) : null;
}

async function deriveSemanticExplorationActions({
  plan,
  currentItemId = null,
  currentItemRevisionId = null,
  currentSubjectId = null,
  maxActions = 12,
}) {
  const subjectId = await resolveCurrentSubjectId({ currentSubjectId, currentItemId });
  if (!subjectId) return [];
  const scope = await loadPinnedEditorialScope(plan);
  if (!scope.rows.length) return [];

  const actions = [];
  const seen = new Set();
  function add(candidate, definition, relationLabel = null) {
    if (actions.length >= maxActions || seen.has(definition.actionId)) return;
    seen.add(definition.actionId);
    actions.push({
      definition,
      serverInput: {
        sourceEditorialReleaseId: candidate.sourceEditorialReleaseId,
        itemId: candidate.itemId,
        itemEditionId: candidate.itemEditionId,
        itemRevisionId: candidate.itemRevisionId,
        namespaceRevisionId: candidate.namespaceRevisionId,
        subjectId: candidate.subjectId,
        relationLabel,
      },
      semanticContext: {
        subjectId: candidate.subjectId,
        itemEditionId: candidate.itemEditionId,
      },
    });
  }

  for (const candidate of scope.rows) {
    if (id(candidate.itemRevisionId) === id(currentItemRevisionId)) continue;
    if (id(candidate.subjectId) !== subjectId) continue;
    add(candidate, semanticDefinition({
      seed: `same-subject|${id(candidate.itemRevisionId)}`,
      label: `Approfondisci: ${candidate.revision.label}`,
    }));
  }

  for (const release of scope.releases) {
    if (actions.length >= maxActions) break;
    const graph = scope.graphByReleaseId.get(id(release._id));
    if (!graph?.nodes?.has(subjectId)) continue;
    for (const edge of neighbors(graph, subjectId)) {
      if (actions.length >= maxActions) break;
      const targetSubjectId = id(edge.toSubjectId);
      const targetSubject = graph.nodes.get(targetSubjectId)?.subject;
      if (!targetSubject) continue;
      const candidates = scope.rows.filter((candidate) =>
        id(candidate.subjectId) === targetSubjectId && id(candidate.itemRevisionId) !== id(currentItemRevisionId));
      for (const candidate of candidates) {
        if (actions.length >= maxActions) break;
        add(candidate, semanticDefinition({
          seed: `related|${id(release._id)}|${id(edge.edgeId)}|${edge.direction}|${id(candidate.itemRevisionId)}`,
          label: `${edge.label}: ${targetSubject.preferredLabel || candidate.revision.label}`,
          controlledVoiceAliases: relationVoiceAliases(graph, edge),
        }), edge.label || null);
      }
    }
  }

  return actions;
}

function preferenceFromRuntime(runtime) {
  if (!runtime?.namespaceRevision || !runtime?.presentation) return null;
  const depthPreference = unitPosition(runtime.namespaceRevision.durationTypes, runtime.presentation.durationTypeDefinitionId);
  const languageComplexityPreference = unitPosition(runtime.namespaceRevision.languageLevels, runtime.presentation.languageLevelDefinitionId);
  const preference = {
    ...(depthPreference == null ? {} : { depthPreference }),
    ...(languageComplexityPreference == null ? {} : { languageComplexityPreference }),
    ...(runtime.presentation.locale ? { locale: runtime.presentation.locale } : {}),
  };
  return Object.keys(preference).length ? preference : null;
}

async function materializeSemanticPresentation({ plan, serverInput, currentRuntime = null, sourceActionId }) {
  const releaseId = id(serverInput?.sourceEditorialReleaseId);
  if (!unique(plan?.sourceEditorialReleaseIds).includes(releaseId)) {
    throw new AppError("La sorgente semantica non appartiene allo scope pinzato", 409, [{ code: "SEMANTIC_SOURCE_NOT_PINNED" }]);
  }
  const release = await EditorialRelease.findById(releaseId).lean();
  if (!release) throw new AppError("EditorialRelease semantica non disponibile", 409, [{ code: "SEMANTIC_SOURCE_UNAVAILABLE" }]);
  const binding = (release.itemBindings || []).find((entry) =>
    id(entry.itemEditionId) === id(serverInput.itemEditionId) && id(entry.itemRevisionId) === id(serverInput.itemRevisionId));
  if (!binding) throw new AppError("Contenuto semantico non appartiene alla release pinzata", 409, [{ code: "SEMANTIC_CONTENT_NOT_PINNED" }]);

  const [revision, namespaceRevision] = await Promise.all([
    ItemRevisionV2.findOne({ _id: serverInput.itemRevisionId, status: { $in: ["published", "superseded"] } }).lean(),
    NamespaceRevision.findById(release.namespaceRevisionId).lean(),
  ]);
  if (!revision || !namespaceRevision) {
    throw new AppError("Presentation semantica non risolvibile", 409, [{ code: "SEMANTIC_PRESENTATION_UNAVAILABLE" }]);
  }
  const presentation = resolveInitialPresentation({
    revision,
    namespaceRevision,
    explicitPreference: preferenceFromRuntime(currentRuntime),
  });
  return {
    sourceActionId,
    sourceEditorialReleaseId: release._id,
    itemId: serverInput.itemId,
    itemEditionId: serverInput.itemEditionId,
    itemRevisionId: revision._id,
    namespaceRevisionId: namespaceRevision._id,
    subjectId: serverInput.subjectId,
    label: revision.label,
    relationLabel: serverInput.relationLabel || null,
    presentation: {
      variantId: presentation.variantId,
      representationId: presentation.representationId,
      durationTypeDefinitionId: presentation.durationTypeDefinitionId,
      languageLevelDefinitionId: presentation.languageLevelDefinitionId,
      locale: presentation.locale,
      estimatedContentSeconds: presentation.estimatedContentSeconds,
    },
    openedAt: new Date(),
  };
}

module.exports = {
  deriveSemanticExplorationActions,
  materializeSemanticPresentation,
};
