const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const {
  id,
  canonicalKey,
  buildFederatedSemanticGraph,
  relationCoherence,
} = require("./federatedSemanticGraphV2.service");
const { candidateNovelty, loadUserLearningState } = require("./learningV2.service");
const {
  resolveGoals,
  scoreCurrentGoals,
  representationPreferenceScore,
  learnedSemanticScore,
  buildReasons,
} = require("./visitGeneratorV2Semantics.service");
const { optimizeVisitV2, transferKey } = require("./visitGeneratorV2Search.service");
const { validateGenerationRequestV2 } = require("./validation/generationV2.validation");
const { loadLayoutPhysicalVocabulary } = require("./layoutPhysicalVocabulary.service");
const { describePhysicalFeatureRef } = require("./physicalVocabularyResolver.service");
const { translateRoutingRequirements } = require("./physicalVocabularyResolver.service");
const {
  resolveGenerationSources,
  resolvePrimaryDefaultGenerationSources,
} = require("./generationSourceV2.service");

function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function mapById(values = []) { return new Map(values.map((entry) => [id(entry._id), entry])); }
function resolveMovementSpeed(preference = 0.5) {
  const p = Math.max(0, Math.min(1, Number(preference ?? 0.5)));
  const calm = policy.coldStart.paceFactors.calm, fast = policy.coldStart.paceFactors.fast;
  return Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, policy.coldStart.movementSpeedMps * (calm + (fast - calm) * p)));
}
function translateRequirements(physicalVocabularyRevision, physicalVocabulary, requirements = []) {
  return translateRoutingRequirements({ requirements, physicalVocabulary, revision: physicalVocabularyRevision });
}

async function loadPhysicalScope(request) {
  const venueIds = uniqueIds(request.venueIds);
  const venues = await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).lean();
  if (venues.length !== venueIds.length) throw new AppError("Una o piu Venue del PhysicalScope non sono disponibili", 409);
  const venueById = mapById(venues), bundles = [], warnings = [];
  for (const venueId of venueIds) {
    const venue = venueById.get(venueId);
    if (!venue?.publishedReleaseId) throw new AppError("Una Venue selezionata non ha una VenueRelease pubblicata", 409, [{ field: "venueIds", code: "VENUE_WITHOUT_PUBLISHED_RELEASE", context: { venueId } }]);
    const release = await VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: venue._id, status: "published" }).lean();
    if (!release || release.integrity?.status !== "valid") throw new AppError("La VenueRelease pubblicata non e utilizzabile", 409, [{ field: "venueIds", code: "VENUE_RELEASE_INVALID", context: { venueId } }]);
    const layout = await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: venue._id, status: { $in: ["published", "superseded"] } }).lean();
    if (!layout) throw new AppError("LayoutRevision della VenueRelease non trovata", 409, [{ field: "venueIds", code: "LAYOUT_REVISION_MISSING", context: { venueId } }]);
    const { physicalVocabulary, revision: physicalVocabularyRevision } = await loadLayoutPhysicalVocabulary(layout, { requireStable: true });
    const translated = translateRequirements(physicalVocabularyRevision, physicalVocabulary, request.navigationRequirements || []);
    if (translated.unsupportedRequired.length) {
      throw new AppError("Una Venue non supporta un requisito di routing necessario", 409, translated.unsupportedRequired.map((reference) => ({ field: "navigationRequirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: describePhysicalFeatureRef(reference), context: { venueId, physicalFeatureRef: reference } })));
    }
    warnings.push(...translated.warnings.map((entry) => ({ ...entry, venueId: venue._id })));
    bundles.push({ venue, release, layout, physicalVocabulary, physicalVocabularyRevision, requirements: translated.requirements });
  }

  const activeBindingRows = bundles.flatMap((bundle) => (bundle.release.targetBindings || [])
    .filter((entry) => entry.availability === "active")
    .map((entry) => ({ bundle, binding: entry })));
  const targetIds = uniqueIds(activeBindingRows.map((entry) => entry.binding.venueTargetId));
  const [targets, profiles] = await Promise.all([
    VenueTarget.find({ _id: { $in: targetIds }, lifecycleStatus: "active" }).lean(),
    VenueTargetObservationProfile.find({ venueTargetId: { $in: targetIds } }).lean(),
  ]);
  const targetById = mapById(targets), profileByTargetId = new Map(profiles.map((entry) => [id(entry.venueTargetId), entry]));
  const physicalTargets = [], targetsBySubjectId = new Map(), layoutByVenue = new Map(), requirementsByVenue = new Map();
  for (const bundle of bundles) {
    layoutByVenue.set(id(bundle.venue._id), bundle.layout);
    requirementsByVenue.set(id(bundle.venue._id), bundle.requirements);
    const placementByTarget = new Map((bundle.layout.venueTargetPlacements || []).map((entry) => [id(entry.venueTargetId), entry]));
    for (const binding of bundle.release.targetBindings || []) {
      if (binding.availability !== "active") continue;
      const target = targetById.get(id(binding.venueTargetId)), placement = placementByTarget.get(id(binding.venueTargetId));
      if (!target || !placement?.primaryPlaceId) throw new AppError("La VenueRelease pubblicata contiene un target fisico non risolvibile", 409, [{ field: "venueIds", code: "ACTIVE_TARGET_WITHOUT_PLACEMENT", context: { venueId: bundle.venue._id, venueTargetId: binding.venueTargetId } }]);
      const profile = profileByTargetId.get(id(target._id));
      const learnedSeconds = Number(profile?.typicalObservationSeconds);
      const reliable = Number(profile?.confidence) >= policy.confidence.usableThreshold && Number.isFinite(learnedSeconds);
      const baseObservation = reliable ? learnedSeconds : policy.coldStart.observationSeconds;
      const observationSeconds = Math.max(0, baseObservation * (0.6 + Number(request.observationEmphasis ?? 0.5) * 0.8));
      const value = {
        venueTargetId: target._id,
        venueId: bundle.venue._id,
        subjectId: target.subjectId,
        placeId: placement.primaryPlaceId,
        venueReleaseId: bundle.release._id,
        layoutRevisionId: bundle.layout._id,
        observationSeconds,
      };
      physicalTargets.push(value);
      const subjectId = id(target.subjectId);
      if (!targetsBySubjectId.has(subjectId)) targetsBySubjectId.set(subjectId, []);
      targetsBySubjectId.get(subjectId).push(value);
    }
  }
  const transferByPair = new Map((request.interVenueTransfers || []).map((entry) => [transferKey(entry.fromVenueId, entry.toVenueId), entry]));
  return {
    venueIds,
    venues,
    bundles,
    physicalTargets,
    targetsBySubjectId,
    layoutByVenue,
    requirementsByVenue,
    transferByPair,
    warnings,
    sourceVenueReleaseIds: bundles.map((entry) => entry.release._id),
    sourceLayoutRevisionIds: bundles.map((entry) => entry.layout._id),
  };
}

async function resolveEditorialSources({ request, physicalScope, actorUserId }) {
  if (Object.prototype.hasOwnProperty.call(request, "editorialSources")) {
    return {
      resolved: await resolveGenerationSources({ sources: request.editorialSources, actorUserId }),
      warnings: [],
      source: "explicit",
    };
  }
  const defaults = await resolvePrimaryDefaultGenerationSources({
    venues: physicalScope.venues,
    actorUserId,
  });
  return {
    resolved: defaults.resolved,
    warnings: defaults.warnings,
    source: "venue_primary_defaults",
  };
}

async function loadEditorialScope({ request, physicalScope, actorUserId }) {
  const resolution = await resolveEditorialSources({ request, physicalScope, actorUserId });
  const bundles = [];
  for (const source of resolution.resolved) {
    const context = source.editorialContext;
    const release = source.editorialRelease;
    const namespaceRevision = await NamespaceRevision.findOne({
      _id: release.namespaceRevisionId,
      namespaceId: context.namespaceId,
    }).lean();
    if (!namespaceRevision) throw new AppError("NamespaceRevision della EditorialRelease non trovata", 409, [{
      field: "editorialSources",
      code: "GENERATION_SOURCE_NAMESPACE_REVISION_MISSING",
      context: { editorialReleaseId: release._id },
    }]);
    const graph = await loadSemanticGraphRevision(release.graphRevisionId, { namespaceRevisionId: release.namespaceRevisionId });
    bundles.push({
      context,
      release,
      namespaceRevision,
      graph,
      namespaceId: context.namespaceId,
      generationSource: {
        requestedSourceRef: source.requestedSourceRef,
        resolvedSourceRef: source.resolvedSourceRef,
        versionMode: source.versionMode,
      },
    });
  }

  const editionIds = uniqueIds(bundles.flatMap((bundle) => (bundle.release.itemBindings || []).map((entry) => entry.itemEditionId)));
  const revisionIds = uniqueIds(bundles.flatMap((bundle) => (bundle.release.itemBindings || []).map((entry) => entry.itemRevisionId)));
  const [editions, revisions] = await Promise.all([
    ItemEdition.find({ _id: { $in: editionIds } }).lean(),
    ItemRevisionV2.find({ _id: { $in: revisionIds }, status: { $in: ["published", "superseded"] } }).lean(),
  ]);
  const editionById = mapById(editions), revisionById = mapById(revisions), itemIds = uniqueIds(editions.map((entry) => entry.itemId));
  const items = await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).lean(), itemById = mapById(items);
  const candidateByEditionRevision = new Map();
  for (const bundle of bundles) {
    for (const binding of bundle.release.itemBindings || []) {
      const edition = editionById.get(id(binding.itemEditionId)), revision = revisionById.get(id(binding.itemRevisionId));
      const item = edition ? itemById.get(id(edition.itemId)) : null;
      if (!edition || !revision || !item || id(revision.itemEditionId) !== id(edition._id)) {
        throw new AppError("EditorialRelease contiene un binding editoriale non piu risolvibile", 409, [{ field: "editorialSources", code: "EDITORIAL_BINDING_UNRESOLVABLE", context: { editorialReleaseId: bundle.release._id, itemEditionId: binding.itemEditionId } }]);
      }
      const key = `${id(edition._id)}:${id(revision._id)}`;
      if (!candidateByEditionRevision.has(key)) {
        candidateByEditionRevision.set(key, {
          item, edition, revision,
          namespaceRevision: bundle.namespaceRevision,
          sourceEditorialReleaseIds: [],
          curationSignals: [],
        });
      }
      const candidate = candidateByEditionRevision.get(key);
      if (!candidate.sourceEditorialReleaseIds.some((value) => id(value) === id(bundle.release._id))) candidate.sourceEditorialReleaseIds.push(bundle.release._id);
      candidate.curationSignals.push(...(binding.curationSignals || []).map((entry) => ({ ...entry, editorialReleaseId: bundle.release._id })));
    }
  }
  const baseCandidates = [...candidateByEditionRevision.values()];
  const graphBundles = bundles.map((bundle) => ({
    graph: bundle.graph,
    namespaceId: bundle.context.namespaceId,
    namespaceRevisionId: bundle.release.namespaceRevisionId,
    editorialReleaseId: bundle.release._id,
    editorialContextId: bundle.context._id,
  }));
  const federatedGraph = buildFederatedSemanticGraph(graphBundles);

  const referencedSubjectIds = uniqueIds(baseCandidates.flatMap((candidate) => [
    candidate.item.primarySubjectId,
    ...(candidate.revision.relatedSubjectIds || []),
    ...(candidate.revision.presentationVariants || []).flatMap((variant) => [
      ...(variant.semanticFocus || []).map((entry) => entry.subjectId),
      ...(variant.knowledgeRequirements || []).map((entry) => entry.subjectId),
    ]),
  ]));
  const missingSubjectIds = referencedSubjectIds.filter((subjectId) => !federatedGraph.nodes.has(subjectId));
  if (missingSubjectIds.length) {
    const subjects = await Subject.find({ _id: { $in: missingSubjectIds } }).lean();
    for (const subject of subjects) {
      const subjectId = id(subject._id);
      federatedGraph.nodes.set(subjectId, { subject, sources: [] });
      for (const identity of subject.externalIdentities || []) {
        const key = canonicalKey(identity);
        if (!federatedGraph.canonicalIndex.has(key)) federatedGraph.canonicalIndex.set(key, new Set());
        federatedGraph.canonicalIndex.get(key).add(subjectId);
      }
    }
  }
  const mergedNamespaceRevisionByNamespaceId = new Map();
  for (const bundle of bundles) {
    const key = id(bundle.context.namespaceId), current = mergedNamespaceRevisionByNamespaceId.get(key) || { subjectClasses: [], relationTypes: [], presentationAspects: [], selectionSignals: [] };
    for (const group of ["subjectClasses", "relationTypes", "presentationAspects", "selectionSignals"]) {
      const seen = new Set(current[group].map((entry) => String(entry.definitionId)));
      for (const definition of bundle.namespaceRevision[group] || []) if (!seen.has(String(definition.definitionId))) { current[group].push(definition); seen.add(String(definition.definitionId)); }
    }
    mergedNamespaceRevisionByNamespaceId.set(key, current);
  }
  return {
    source: resolution.source,
    warnings: resolution.warnings,
    contexts: [...new Map(bundles.map((bundle) => [id(bundle.context._id), bundle.context])).values()],
    bundles,
    baseCandidates,
    federatedGraph,
    namespaceRevisionByNamespaceId: mergedNamespaceRevisionByNamespaceId,
    requestedSourceRefs: bundles.map((bundle) => bundle.generationSource.requestedSourceRef),
    resolvedSources: bundles.map((bundle) => ({
      requestedSourceRef: bundle.generationSource.requestedSourceRef,
      resolvedSourceRef: bundle.generationSource.resolvedSourceRef,
      editorialContextId: bundle.context._id,
      editorialReleaseId: bundle.release._id,
      versionMode: bundle.generationSource.versionMode,
    })),
    sourceEditorialReleaseIds: bundles.map((entry) => entry.release._id),
  };
}

function physicalAssociationScore({ candidate, target, graph }) {
  if (id(candidate.item.primarySubjectId) === id(target.subjectId)) return 1;
  const focus = (candidate.variant.semanticFocus || []).find((entry) => id(entry.subjectId) === id(target.subjectId));
  if (focus) return Math.min(0.95, 0.75 + (Number(focus.weight) || 1) * 0.15);
  const coherence = relationCoherence(graph, candidate.item.primarySubjectId, target.subjectId);
  return coherence > 0 ? Math.min(0.8, 0.45 + coherence) : 0;
}

async function buildCandidateOptions({ userId, request, editorialScope, physicalScope }) {
  const subjectIds = uniqueIds(editorialScope.baseCandidates.flatMap((candidate) => [candidate.item.primarySubjectId, ...(candidate.revision.presentationVariants || []).flatMap((variant) => (variant.semanticFocus || []).map((entry) => entry.subjectId))]));
  const editionIds = uniqueIds(editorialScope.baseCandidates.map((candidate) => candidate.edition._id));
  const namespaceIds = uniqueIds(editorialScope.baseCandidates.map((candidate) => candidate.edition.namespaceId));
  const learningState = request.historyMode === "full"
    ? await loadUserLearningState({ userId, subjectIds, itemEditionIds: editionIds, namespaceIds })
    : { subjectAffinityById: new Map(), subjectKnowledgeById: new Map(), editionAffinityById: new Map(), exposuresByEdition: new Map(), namespaceFeatureAffinityByKey: new Map(), subjectAffinities: [], exposures: [] };
  const goals = resolveGoals({ request, graph: editorialScope.federatedGraph, namespaceRevisionByNamespaceId: editorialScope.namespaceRevisionByNamespaceId });
  if (goals.errors.length) throw new AppError("Alcuni goal richiesti non sono risolvibili nell'EditorialScope", 409, goals.errors);
  const excluded = new Set((request.excludedItemEditionIds || []).map(id)), options = [];
  for (const base of editorialScope.baseCandidates) {
    if (excluded.has(id(base.edition._id))) continue;
    for (const variant of base.revision.presentationVariants || []) {
      for (const representation of variant.representations || []) {
        const candidate = { ...base, variant, representation };
        const goalScore = scoreCurrentGoals({ goals, candidate, graph: editorialScope.federatedGraph });
        if (goalScore.avoidHits.length) continue;
        const presentation = representationPreferenceScore({ request, candidate, learningState });
        if (!presentation.eligible) continue;
        const durationDefinition = (base.namespaceRevision.durationTypes || []).find((entry) => String(entry.definitionId) === String(representation.durationTypeDefinitionId));
        const targetSeconds = Number(durationDefinition?.targetSeconds);
        if (!Number.isFinite(targetSeconds) || targetSeconds < policy.generator.minimumContentSeconds) continue;
        const novelty = candidateNovelty(learningState, { itemEditionId: base.edition._id, variantId: variant._id, representationId: representation._id });
        const learnedInterest = learnedSemanticScore({ candidate, graph: editorialScope.federatedGraph, learningState });
        const discovery = Number(request.discoveryPreference ?? 0.5) * novelty.score * 0.45;
        const densityPenalty = Number(request.visitDensity ?? 0.5) * (targetSeconds / Math.max(Number(request.timeBudgetSeconds), 1));
        const nonExplicitUtility = learnedInterest * 0.8 + presentation.score + discovery - densityPenalty;
        const common = {
          ...candidate,
          targetSeconds,
          requiredCoverageKeys: goalScore.requiredCoverageKeys,
          preferenceMatches: goalScore.preferenceMatches,
          explicitPreference: goalScore.explicitPreference,
          learnedInterest,
          noveltyScore: novelty.score,
          noveltyReason: novelty.reason,
          nonExplicitUtility,
          baseUtility: goalScore.explicitPreference + nonExplicitUtility,
          scoreBreakdown: {
            explicitPreference: goalScore.explicitPreference,
            learnedInterest,
            depthFit: presentation.depthFit,
            languageFit: presentation.languageFit,
            audienceFit: presentation.audienceFit,
            knowledgeFit: presentation.knowledgeFit,
            localeFit: presentation.localeFit,
            discovery,
            novelty: novelty.score,
          },
        };
        options.push({ ...common, target: null });
        const associated = physicalScope.physicalTargets
          .map((target) => ({ target, score: physicalAssociationScore({ candidate, target, graph: editorialScope.federatedGraph }) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        for (const entry of associated) {
          const physicalBonus = entry.score * policy.generator.inSituUtilityWeight;
          options.push({ ...common, target: entry.target, nonExplicitUtility: nonExplicitUtility + physicalBonus, baseUtility: common.baseUtility + physicalBonus, scoreBreakdown: { ...common.scoreBreakdown, physicalAssociation: entry.score } });
        }
      }
    }
  }
  return { options, learningState, goals };
}

function assertNoConflictingRequiredEditions(options, request) {
  const required = new Set((request.mustIncludeItemEditionIds || []).map(id));
  if (required.size < 2) return;
  const itemByEdition = new Map();
  for (const option of options) if (required.has(id(option.edition._id))) itemByEdition.set(id(option.edition._id), id(option.item._id));
  const seen = new Map();
  for (const [editionId, itemId] of itemByEdition) {
    if (seen.has(itemId) && seen.get(itemId) !== editionId) throw new AppError("Due ItemEdition richieste appartengono alla stessa Item lineage", 409, [{ field: "mustIncludeItemEditionIds", code: "MULTIPLE_EDITIONS_SAME_ITEM", context: { itemId, itemEditionIds: [seen.get(itemId), editionId] } }]);
    seen.set(itemId, editionId);
  }
}

async function loadGenerationDataV2({ userId, request }) {
  const requestErrors = validateGenerationRequestV2(request || {});
  if (requestErrors.length) throw new AppError("Richiesta di generazione v2 non valida", 400, requestErrors);
  const physicalScope = await loadPhysicalScope(request);
  const editorialScope = await loadEditorialScope({ request, physicalScope, actorUserId: userId });
  const candidateData = await buildCandidateOptions({ userId, request, editorialScope, physicalScope });
  if (!candidateData.options.length) throw new AppError("Nessun contenuto compatibile disponibile per la generazione", 409);
  assertNoConflictingRequiredEditions(candidateData.options, request);
  return { physicalScope, editorialScope, ...candidateData };
}

async function generateVisitPlanV2({ userId, request, persist = true }) {
  const data = await loadGenerationDataV2({ userId, request });
  const context = {
    timeBudgetSeconds: Number(request.timeBudgetSeconds),
    hardTimeBudget: request.hardTimeBudget !== false,
    coverageGoal: request.coverageGoal || "balanced",
    mustIncludeItemEditionIds: request.mustIncludeItemEditionIds || [],
    mustVisitVenueTargetIds: request.mustVisitVenueTargetIds || [],
    observationEmphasis: Number(request.observationEmphasis ?? 0.5),
    visitDensity: Number(request.visitDensity ?? 0.5),
    timeRiskTolerance: Number(request.timeRiskTolerance ?? 0.5),
    effectiveMovementSpeedMps: resolveMovementSpeed(request.movementPacePreference),
  };
  const { best, reservedSeconds, searchDiagnostics } = optimizeVisitV2({
    options: data.options,
    context,
    graph: data.editorialScope.federatedGraph,
    layoutByVenue: data.physicalScope.layoutByVenue,
    requirementsByVenue: data.physicalScope.requirementsByVenue,
    transferByPair: data.physicalScope.transferByPair,
    requiredSemanticKeys: data.goals.requiredKeys,
  });
  const mustEditions = new Set((request.mustIncludeItemEditionIds || []).map(id)), mustTargets = new Set((request.mustVisitVenueTargetIds || []).map(id));
  const contentEntries = best.entries.map((entry) => {
    const option = entry.option;
    const core = mustEditions.has(id(option.edition._id)) || (option.target && mustTargets.has(id(option.target.venueTargetId))) || option.requiredCoverageKeys.length || context.coverageGoal === "all";
    return {
      _id: entry._id,
      itemId: option.item._id,
      itemEditionId: option.edition._id,
      itemRevisionId: option.revision._id,
      sourceEditorialReleaseIds: option.sourceEditorialReleaseIds,
      role: core ? "core" : "recommended",
      deliveryAnchorId: entry.deliveryAnchorId,
      variantId: option.variant._id,
      representationId: option.representation._id,
      durationTypeDefinitionId: option.representation.durationTypeDefinitionId,
      languageLevelDefinitionId: option.representation.languageLevelDefinitionId,
      locale: option.representation.locale,
      estimatedContentSeconds: Math.round(option.targetSeconds),
      utilityScore: option.baseUtility,
      scoreBreakdown: option.scoreBreakdown,
      reasons: buildReasons(option),
    };
  });
  const warnings = [...data.physicalScope.warnings, ...data.editorialScope.warnings, ...data.goals.warnings];
  const document = {
    userId,
    requestSnapshot: {
      ...request,
      venueIds: data.physicalScope.venueIds,
      editorialSources: data.editorialScope.requestedSourceRefs,
      editorialScopeSource: data.editorialScope.source,
    },
    contextSnapshot: {
      editorialSources: data.editorialScope.resolvedSources,
      venueIds: data.physicalScope.venueIds,
      depthPreference: request.depthPreference ?? null,
      languageComplexityPreference: request.languageComplexityPreference ?? null,
      locale: request.locale || null,
      audience: request.audience || null,
      knowledge: request.knowledge || [],
      historyMode: request.historyMode || "full",
      effectiveMovementSpeedMps: context.effectiveMovementSpeedMps,
      navigationRequirements: request.navigationRequirements || [],
    },
    sourceEditorialReleaseIds: data.editorialScope.sourceEditorialReleaseIds,
    sourceVenueReleaseIds: data.physicalScope.sourceVenueReleaseIds,
    sourceLayoutRevisionIds: data.physicalScope.sourceLayoutRevisionIds,
    adaptivePolicyVersion: policy.version,
    contentEntries,
    visitAnchors: best.anchors,
    physicalRoute: { legs: best.legs },
    estimatedTiming: {
      contentSeconds: Math.round(best.contentSeconds),
      observationSeconds: Math.round(best.observationSeconds),
      logisticsSeconds: Math.round(best.logisticsSeconds),
      totalSeconds: Math.round(best.elapsedSeconds),
      reservedSeconds,
    },
    utilityScore: best.utility,
    explanation: {
      warnings,
      requiredSemanticCoverage: data.goals.requiredKeys,
      usedLearnedHistory: (request.historyMode || "full") === "full" && Boolean(data.learningState.subjectAffinities?.length || data.learningState.editionAffinities?.length || data.learningState.exposures?.length),
      currentRequestPriority: "lexicographic",
      searchDiagnostics,
      generatedBy: "adaptive_federated_editorial_physical_v2",
    },
  };
  return persist ? GeneratedVisitPlanV2.create(document) : document;
}

async function getGeneratedPlanV2({ planId, userId }) {
  const plan = await GeneratedVisitPlanV2.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("Piano generato v2 non trovato", 404);
  return plan;
}
async function acceptGeneratedPlanV2({ planId, userId }) {
  const plan = await getGeneratedPlanV2({ planId, userId });
  plan.status = "accepted";
  plan.acceptedAt = new Date();
  await plan.save();
  return plan;
}

module.exports = {
  resolveMovementSpeed,
  translateRequirements,
  loadPhysicalScope,
  resolveEditorialSources,
  loadEditorialScope,
  physicalAssociationScore,
  buildCandidateOptions,
  loadGenerationDataV2,
  generateVisitPlanV2,
  getGeneratedPlanV2,
  acceptGeneratedPlanV2,
};
