const crypto = require("crypto");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { loadSemanticGraphRevision, neighbors } = require("./semanticGraphV2.service");
const { resolveInitialPresentation, unitPosition } = require("./presentationRuntimeV2.service");
const { resolveSemanticRelationTargets } = require("./semanticItemResolverV2.service");

function id(value) { return String(value?._id || value || ""); }
function unique(values) { return [...new Set((values || []).map(id).filter(Boolean))]; }
function opaqueActionId(kind, seed) {
  return `semantic.${kind}.${crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 20)}`;
}

function semanticContentDefinition({ seed, label, controlledVoiceAliases = [], hidden = false }) {
  return {
    actionId: opaqueActionId("content", seed),
    type: "EXPLORE_SEMANTIC_CONTENT",
    family: "semantic",
    label,
    controlledVoiceAliases: [...new Set((controlledVoiceAliases || []).map((value) => String(value || "").trim()).filter(Boolean))],
    ...(hidden ? { hidden: true } : {}),
  };
}

function semanticRelationDefinition({ seed, label, controlledVoiceAliases = [] }) {
  return {
    actionId: opaqueActionId("relation", seed),
    type: "EXPLORE_SEMANTIC_RELATION",
    family: "semantic",
    label,
    controlledVoiceAliases: [...new Set((controlledVoiceAliases || []).map((value) => String(value || "").trim()).filter(Boolean))],
  };
}

async function loadReleaseRows(plan) {
  const releaseIds = unique(plan?.sourceEditorialReleaseIds);
  if (!releaseIds.length) return { releases: [], rows: [] };

  const loadedReleases = await EditorialRelease.find({ _id: { $in: releaseIds } }).lean();
  const releaseById = new Map(loadedReleases.map((release) => [id(release._id), release]));
  for (const releaseId of releaseIds) {
    if (!releaseById.has(releaseId)) {
      throw new AppError("EditorialRelease pinzata dalla Session non disponibile", 409, [{ code: "SESSION_EDITORIAL_SCOPE_UNAVAILABLE" }]);
    }
  }
  const releases = releaseIds.map((releaseId) => releaseById.get(releaseId));

  const bindingRows = releases.flatMap((release) => (release.itemBindings || []).map((binding) => ({
    release,
    itemEditionId: binding.itemEditionId,
    itemRevisionId: binding.itemRevisionId,
    curationSignals: binding.curationSignals || [],
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
      sourceType: "editorial_release",
      sourceEditorialReleaseId: binding.release._id,
      sourceEditorialReleaseIds: [binding.release._id],
      namespaceRevisionId: binding.release.namespaceRevisionId,
      itemId: item._id,
      itemEditionId: edition._id,
      itemRevisionId: revision._id,
      subjectId: item.primarySubjectId,
      item,
      edition,
      revision,
      curationSignals: binding.curationSignals || [],
    });
  }
  return { releases, rows };
}

async function loadDirectRows(plan) {
  const pins = (plan?.semanticContentPins || []).length
    ? plan.semanticContentPins
    : (plan?.contentEntries || []).filter((entry) => !(entry.sourceEditorialReleaseIds || []).length);
  if (!pins.length) return [];
  const revisionIds = unique(pins.map((entry) => entry.itemRevisionId));
  const itemIds = unique(pins.map((entry) => entry.itemId));
  const [revisions, items] = await Promise.all([
    ItemRevisionV2.find({ _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } }).lean(),
    ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).lean(),
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemById = new Map(items.map((item) => [id(item._id), item]));
  return pins.map((entry) => {
    const revision = revisionById.get(id(entry.itemRevisionId));
    const item = itemById.get(id(entry.itemId));
    if (!revision || !item || id(revision.itemEditionId) !== id(entry.itemEditionId)) return null;
    return {
      sourceType: "direct_item",
      sourceEditorialReleaseId: null,
      sourceEditorialReleaseIds: [],
      namespaceRevisionId: entry.namespaceRevisionId,
      itemId: entry.itemId,
      itemEditionId: entry.itemEditionId,
      itemRevisionId: entry.itemRevisionId,
      subjectId: entry.subjectId || item.primarySubjectId,
      item,
      edition: null,
      revision,
      curationSignals: [],
    };
  }).filter(Boolean);
}

function deduplicateRows(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${id(row.itemId)}:${id(row.itemEditionId)}:${id(row.itemRevisionId)}`;
    const existing = byKey.get(key);
    if (!existing || row.sourceType === "editorial_release") byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function loadPinnedGraphs(plan, releases) {
  const explicitPins = (plan?.semanticGraphPins || []).map((pin) => ({
    sourceType: pin.sourceType,
    sourceEditorialReleaseId: pin.sourceEditorialReleaseId || null,
    editorialContextId: pin.editorialContextId,
    graphRevisionId: pin.graphRevisionId,
    namespaceRevisionId: pin.namespaceRevisionId,
  }));
  const pins = explicitPins.length ? explicitPins : (releases || []).map((release) => ({
    sourceType: "editorial_release",
    sourceEditorialReleaseId: release._id,
    editorialContextId: release.editorialContextId,
    graphRevisionId: release.graphRevisionId,
    namespaceRevisionId: release.namespaceRevisionId,
  }));
  const graphs = [];
  for (const pin of pins) {
    try {
      const graph = await loadSemanticGraphRevision(pin.graphRevisionId, { namespaceRevisionId: pin.namespaceRevisionId });
      graphs.push({ pin, graph });
    } catch (error) {
      if (error?.status === 404 || error?.status === 409) {
        throw new AppError("SemanticGraphRevision pinzata dalla Session non disponibile", 409, [{ code: "SESSION_SEMANTIC_SCOPE_UNAVAILABLE" }]);
      }
      throw error;
    }
  }
  return graphs;
}

async function loadPinnedSemanticScope(plan) {
  const [{ releases, rows: releaseRows }, directRows] = await Promise.all([
    loadReleaseRows(plan),
    loadDirectRows(plan),
  ]);
  const rows = deduplicateRows([...releaseRows, ...directRows]);
  const graphs = await loadPinnedGraphs(plan, releases);
  return { releases, rows, graphs };
}

function relationDefinition(graph, edge) {
  return (graph?.namespaceRevision?.relationTypes || []).find((entry) =>
    String(entry.definitionId) === String(edge.relationTypeDefinitionId)) || null;
}

function relationVoiceAliases(definition, direction) {
  if (!definition) return [];
  return direction === "reverse" ? definition.reverse?.userIntents || [] : definition.userIntents || [];
}

function relationLabel(definition, edge, direction) {
  if (direction === "reverse") return definition?.reverse?.label || edge?.label || definition?.label || "Approfondisci";
  return definition?.label || edge?.label || "Approfondisci";
}

function naturalRelationActionLabel(definition, edge, direction) {
  const firstIntent = relationVoiceAliases(definition, direction)
    .map((value) => String(value || "").trim())
    .find(Boolean);
  const label = firstIntent || relationLabel(definition, edge, direction);
  return label ? label.charAt(0).toLocaleUpperCase("it-IT") + label.slice(1) : "Approfondisci";
}

function candidateServerInput(candidate, relation = null) {
  return {
    sourceType: candidate.sourceType,
    sourceEditorialReleaseId: candidate.sourceEditorialReleaseId || null,
    itemId: candidate.itemId,
    itemEditionId: candidate.itemEditionId,
    itemRevisionId: candidate.itemRevisionId,
    namespaceRevisionId: candidate.namespaceRevisionId,
    subjectId: candidate.subjectId,
    relationLabel: relation,
  };
}

function publicChoice(definition) {
  return {
    actionId: definition.actionId,
    type: definition.type,
    family: definition.family,
    label: definition.label,
    controlledVoiceAliases: [...(definition.controlledVoiceAliases || [])],
    semanticChoice: true,
  };
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
  const scope = await loadPinnedSemanticScope(plan);
  if (!scope.rows.length) return [];

  const actions = [];
  const publicActionIds = new Set();
  function addPublic(action) {
    if (publicActionIds.size >= maxActions || publicActionIds.has(action.definition.actionId)) return false;
    publicActionIds.add(action.definition.actionId);
    actions.push(action);
    return true;
  }
  function addHidden(action) {
    if (!actions.some((entry) => entry.definition.actionId === action.definition.actionId)) actions.push(action);
  }

  for (const candidate of scope.rows) {
    if (publicActionIds.size >= maxActions) break;
    if (id(candidate.itemRevisionId) === id(currentItemRevisionId)) continue;
    if (id(candidate.subjectId) !== subjectId) continue;
    addPublic({
      definition: semanticContentDefinition({
        seed: `same-subject|${id(candidate.itemRevisionId)}`,
        label: `Approfondisci: ${candidate.revision.label}`,
      }),
      serverInput: candidateServerInput(candidate),
      semanticContext: { subjectId: candidate.subjectId, itemEditionId: candidate.itemEditionId },
    });
  }

  const groups = new Map();
  for (const { pin, graph } of scope.graphs) {
    if (!graph?.nodes?.has(subjectId)) continue;
    for (const edge of neighbors(graph, subjectId)) {
      const targetSubjectId = id(edge.toSubjectId);
      const targetSubject = graph.nodes.get(targetSubjectId)?.subject;
      if (!targetSubject) continue;
      const definition = relationDefinition(graph, edge);
      if (!definition) continue;
      const direction = edge.generated ? "reverse" : "forward";
      const key = `${id(pin.namespaceRevisionId)}:${definition.definitionId}:${direction}`;
      if (!groups.has(key)) groups.set(key, {
        key,
        definition,
        direction,
        relationLabel: relationLabel(definition, edge, direction),
        actionLabel: naturalRelationActionLabel(definition, edge, direction),
        aliases: relationVoiceAliases(definition, direction),
        targets: new Map(),
      });
      const group = groups.get(key);
      group.aliases = [...new Set([...group.aliases, ...relationVoiceAliases(definition, direction)])];
      if (!group.targets.has(targetSubjectId)) group.targets.set(targetSubjectId, {
        subjectId: targetSubjectId,
        subject: targetSubject,
        candidates: [],
      });
      const target = group.targets.get(targetSubjectId);
      target.candidates.push(...scope.rows.filter((candidate) =>
        id(candidate.subjectId) === targetSubjectId && id(candidate.itemRevisionId) !== id(currentItemRevisionId)));
    }
  }

  for (const group of groups.values()) {
    if (publicActionIds.size >= maxActions) break;
    const targets = [...group.targets.values()].filter((target) => target.candidates.length);
    if (!targets.length) continue;
    const resolution = resolveSemanticRelationTargets({
      targets,
      relationType: group.definition,
      direction: group.direction,
    });
    if (resolution.status === "unavailable") continue;

    const relationDefinitionValue = semanticRelationDefinition({
      seed: `${subjectId}|${group.key}`,
      label: group.actionLabel,
      controlledVoiceAliases: group.aliases,
    });
    const relation = group.relationLabel;

    if (resolution.status === "resolved") {
      const selected = resolution.selected;
      addPublic({
        definition: relationDefinitionValue,
        serverInput: {
          resolution: {
            status: "resolved",
            selected: candidateServerInput(selected, relation),
          },
        },
        semanticContext: { subjectId: selected.subjectId, itemEditionId: selected.itemEditionId },
      });
      continue;
    }

    const choices = [];
    for (const target of resolution.targets || []) {
      const candidates = target.resolution?.status === "resolved"
        ? [target.resolution.selected]
        : target.resolution?.candidates || [];
      for (const candidate of candidates) {
        const choiceDefinition = semanticContentDefinition({
          seed: `relation-choice|${group.key}|${id(candidate.itemRevisionId)}`,
          label: `${target.subject?.preferredLabel || "Approfondimento"} — ${candidate.revision?.label || "Contenuto"}`,
          hidden: true,
        });
        const choiceAction = {
          definition: choiceDefinition,
          serverInput: candidateServerInput(candidate, relation),
          semanticContext: { subjectId: candidate.subjectId, itemEditionId: candidate.itemEditionId },
        };
        addHidden(choiceAction);
        choices.push(publicChoice(choiceDefinition));
      }
    }
    if (!choices.length) continue;
    addPublic({
      definition: relationDefinitionValue,
      serverInput: { resolution: { status: "ambiguous", choices } },
      semanticContext: { subjectId },
    });
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

async function resolvePinnedSemanticContent({ plan, serverInput }) {
  const sourceType = serverInput?.sourceType || (serverInput?.sourceEditorialReleaseId ? "editorial_release" : "direct_item");
  if (sourceType === "direct_item") {
    const contentPins = (plan?.semanticContentPins || []).length
      ? plan.semanticContentPins
      : (plan?.contentEntries || []).filter((entry) => !(entry.sourceEditorialReleaseIds || []).length);
    const pinnedEntry = contentPins.find((entry) =>
      id(entry.itemId) === id(serverInput.itemId)
      && id(entry.itemEditionId) === id(serverInput.itemEditionId)
      && id(entry.itemRevisionId) === id(serverInput.itemRevisionId));
    if (!pinnedEntry || id(pinnedEntry.namespaceRevisionId) !== id(serverInput.namespaceRevisionId)) {
      throw new AppError("Contenuto semantico diretto non appartiene allo scope pinzato", 409, [{ code: "SEMANTIC_CONTENT_NOT_PINNED" }]);
    }
    const [revision, namespaceRevision] = await Promise.all([
      ItemRevisionV2.findOne({ _id: pinnedEntry.itemRevisionId, status: { $in: ["published", "superseded"] } }).lean(),
      NamespaceRevision.findById(pinnedEntry.namespaceRevisionId).lean(),
    ]);
    return { sourceType, sourceEditorialReleaseId: null, revision, namespaceRevision };
  }

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
  return { sourceType, sourceEditorialReleaseId: release._id, revision, namespaceRevision };
}

async function materializeSemanticPresentation({ plan, serverInput, currentRuntime = null, sourceActionId }) {
  const resolved = await resolvePinnedSemanticContent({ plan, serverInput });
  const { revision, namespaceRevision } = resolved;
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
    sourceType: resolved.sourceType,
    sourceEditorialReleaseId: resolved.sourceEditorialReleaseId,
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
