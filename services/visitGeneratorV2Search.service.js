const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { resolveRoute } = require("./graphRouting.service");
const { id, relationCoherence } = require("./federatedSemanticGraphV2.service");

function newObjectId() { return new mongoose.Types.ObjectId(); }
function transferKey(fromVenueId, toVenueId) { return `${id(fromVenueId)}>${id(toVenueId)}`; }
function stateKey(state) {
  return `${[...state.selectedItemIds].sort().join(",")}|${id(state.currentTargetId)}|${[...state.hardCoverage].sort().join(",")}`;
}
function compareStates(left, right, requiredCount) {
  const leftComplete = left.hardCovered === requiredCount ? 1 : 0, rightComplete = right.hardCovered === requiredCount ? 1 : 0;
  if (leftComplete !== rightComplete) return rightComplete - leftComplete;
  if (left.hardCovered !== right.hardCovered) return right.hardCovered - left.hardCovered;
  if (Math.abs(left.explicitScore - right.explicitScore) > 1e-9) return right.explicitScore - left.explicitScore;
  if (Math.abs(left.utility - right.utility) > 1e-9) return right.utility - left.utility;
  return left.elapsedSeconds - right.elapsedSeconds;
}
function pruneBeam(states, requiredCount, width) {
  const bestByKey = new Map();
  for (const state of states) {
    const key = stateKey(state), existing = bestByKey.get(key);
    if (!existing || compareStates(state, existing, requiredCount) < 0) bestByKey.set(key, state);
  }
  return [...bestByKey.values()].sort((a, b) => compareStates(a, b, requiredCount)).slice(0, width);
}

function optimizeVisitV2({
  options,
  context,
  graph,
  layoutByVenue,
  requirementsByVenue = new Map(),
  transferByPair = new Map(),
  requiredSemanticKeys = [],
}) {
  const mustIncludeEditions = new Set((context.mustIncludeItemEditionIds || []).map(id));
  const mustVisitTargets = new Set((context.mustVisitVenueTargetIds || []).map(id));
  const requireAllItems = context.coverageGoal === "all" ? new Set(options.map((option) => id(option.item._id))) : new Set();
  const availableEditions = new Set(options.map((option) => id(option.edition._id)));
  const availableTargets = new Set(options.filter((option) => option.target).map((option) => id(option.target.venueTargetId)));
  const availableItems = new Set(options.map((option) => id(option.item._id)));
  const missingEditions = [...mustIncludeEditions].filter((value) => !availableEditions.has(value));
  const missingTargets = [...mustVisitTargets].filter((value) => !availableTargets.has(value));
  const missingItems = [...requireAllItems].filter((value) => !availableItems.has(value));
  if (missingEditions.length || missingTargets.length || missingItems.length) {
    throw new AppError("Alcuni vincoli di generazione non sono soddisfacibili", 409, [
      ...missingEditions.map((value) => ({ field: "mustIncludeItemEditionIds", code: "MUST_INCLUDE_UNAVAILABLE", message: `ItemEdition non includibile: ${value}` })),
      ...missingTargets.map((value) => ({ field: "mustVisitVenueTargetIds", code: "MUST_VISIT_UNAVAILABLE", message: `VenueTarget non visitabile: ${value}` })),
      ...missingItems.map((value) => ({ field: "coverageGoal", code: "COVERAGE_ITEM_UNAVAILABLE", message: `Item lineage non copribile: ${value}` })),
    ]);
  }

  const hardKeys = [
    ...[...mustIncludeEditions].map((value) => `edition:${value}`),
    ...[...mustVisitTargets].map((value) => `target:${value}`),
    ...[...requireAllItems].map((value) => `item:${value}`),
    ...(requiredSemanticKeys || []),
  ];
  const hardKeySet = new Set(hardKeys), requiredCount = hardKeys.length;
  const reserveRatio = policy.generator.conservativeTimeReserveRatio * (1 - Number(context.timeRiskTolerance ?? 0.5));
  const reservedSeconds = Math.round(context.timeBudgetSeconds * Math.max(0, reserveRatio));
  const usableBudget = Math.max(1, context.timeBudgetSeconds - reservedSeconds);
  const routeCache = new Map();

  function optionHardKeys(option) {
    const values = [];
    if (mustIncludeEditions.has(id(option.edition._id))) values.push(`edition:${id(option.edition._id)}`);
    if (option.target && mustVisitTargets.has(id(option.target.venueTargetId))) values.push(`target:${id(option.target.venueTargetId)}`);
    if (requireAllItems.has(id(option.item._id))) values.push(`item:${id(option.item._id)}`);
    for (const key of option.requiredCoverageKeys || []) if (hardKeySet.has(key)) values.push(key);
    return [...new Set(values)];
  }

  function routeBetween(state, target) {
    if (!state.currentTargetId) return { reachable: true, type: null, estimatedSeconds: 0, preferencePenalty: 0, path: [] };
    if (id(state.currentVenueId) !== id(target.venueId)) {
      const transfer = transferByPair.get(transferKey(state.currentVenueId, target.venueId));
      if (!transfer) return { reachable: false };
      return { reachable: true, type: "inter_venue", estimatedSeconds: Number(transfer.estimatedSeconds), preferencePenalty: 0, path: [], instruction: transfer.instruction || null };
    }
    if (id(state.currentTargetId) === id(target.venueTargetId)) return { reachable: true, type: null, estimatedSeconds: 0, preferencePenalty: 0, path: [] };
    const layout = layoutByVenue.get(id(target.venueId));
    if (!layout) return { reachable: false };
    const key = `${id(layout._id)}:${id(state.currentPlaceId)}>${id(target.placeId)}`;
    if (!routeCache.has(key)) {
      routeCache.set(key, resolveRoute({
        connections: layout.connections || [],
        fromPlaceId: state.currentPlaceId,
        toPlaceId: target.placeId,
        requirements: requirementsByVenue.get(id(target.venueId)) || [],
        speedMps: context.effectiveMovementSpeedMps,
        learnedResidualByConnection: new Map(),
      }));
    }
    const route = routeCache.get(key);
    return { ...route, type: "indoor" };
  }

  function emptyState() {
    return {
      selectedItemIds: new Set(),
      visitedTargetIds: new Set(),
      hardCoverage: new Set(),
      hardCovered: 0,
      currentTargetId: null,
      currentVenueId: null,
      currentPlaceId: null,
      currentAnchorId: null,
      entries: [],
      anchors: [],
      legs: [],
      elapsedSeconds: 0,
      contentSeconds: 0,
      observationSeconds: 0,
      logisticsSeconds: 0,
      explicitScore: 0,
      utility: 0,
      subjectCounts: new Map(),
      preferenceCoverageCounts: new Map(),
      lastOption: null,
    };
  }

  function preferenceGain(state, option) {
    const matches = option.preferenceMatches || [];
    if (!matches.length) return Number(option.explicitPreference) || 0;
    return matches.reduce((sum, match) => sum + (Number(match.score) || 0) / (1 + (state.preferenceCoverageCounts.get(match.key) || 0)), 0) / matches.length;
  }
  function nonExplicitGain(state, option, routeSeconds, createsAnchor) {
    const subjectId = id(option.item.primarySubjectId), sameSubjectCount = state.subjectCounts.get(subjectId) || 0;
    const repetitionPenalty = Math.max(0, sameSubjectCount - 1) * 0.12;
    const coherence = relationCoherence(graph, state.lastOption?.item?.primarySubjectId, option.item.primarySubjectId);
    const logisticsPenalty = (routeSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
    const physicalGain = createsAnchor ? policy.generator.inSituUtilityWeight * (0.5 + Number(context.observationEmphasis ?? 0.5)) : 0;
    return (Number(option.nonExplicitUtility) || 0) + coherence + physicalGain - repetitionPenalty - logisticsPenalty;
  }

  function appendOption(state, option) {
    const itemId = id(option.item._id);
    if (state.selectedItemIds.has(itemId)) return null;
    let route = { reachable: true, type: null, estimatedSeconds: 0, preferencePenalty: 0, path: [] };
    let createsAnchor = false, deliveryAnchorId = state.currentAnchorId, observationSeconds = 0;
    if (option.target) {
      const targetId = id(option.target.venueTargetId);
      if (state.visitedTargetIds.has(targetId) && id(state.currentTargetId) !== targetId) return null;
      route = routeBetween(state, option.target);
      if (!route.reachable) return null;
      createsAnchor = id(state.currentTargetId) !== targetId;
      observationSeconds = createsAnchor ? Number(option.target.observationSeconds) || 0 : 0;
    }
    const nextElapsed = state.elapsedSeconds + Number(option.targetSeconds || 0) + observationSeconds + Number(route.estimatedSeconds || 0);
    if (context.hardTimeBudget !== false && nextElapsed > usableBudget) return null;

    const entryId = newObjectId(), anchors = [...state.anchors], legs = [...state.legs];
    let currentTargetId = state.currentTargetId, currentVenueId = state.currentVenueId, currentPlaceId = state.currentPlaceId, currentAnchorId = state.currentAnchorId;
    const visitedTargetIds = new Set(state.visitedTargetIds);
    if (option.target && createsAnchor) {
      const anchor = {
        _id: newObjectId(),
        venueTargetId: option.target.venueTargetId,
        venueId: option.target.venueId,
        placeId: option.target.placeId,
        estimatedObservationSeconds: Math.round(observationSeconds),
      };
      if (state.currentAnchorId && route.type) {
        legs.push({
          _id: newObjectId(),
          type: route.type,
          fromAnchorId: state.currentAnchorId,
          toAnchorId: anchor._id,
          venueReleaseId: route.type === "indoor" ? option.target.venueReleaseId : null,
          layoutRevisionId: route.type === "indoor" ? option.target.layoutRevisionId : null,
          path: (route.path || []).map((entry) => entry.connectionId || entry),
          estimatedSeconds: Math.round(Number(route.estimatedSeconds) || 0),
          preferencePenalty: Number(route.preferencePenalty) || 0,
          instruction: route.instruction || null,
        });
      }
      anchors.push(anchor);
      visitedTargetIds.add(id(option.target.venueTargetId));
      deliveryAnchorId = anchor._id;
      currentTargetId = option.target.venueTargetId;
      currentVenueId = option.target.venueId;
      currentPlaceId = option.target.placeId;
      currentAnchorId = anchor._id;
    } else if (option.target) {
      deliveryAnchorId = state.currentAnchorId;
    }

    const selectedItemIds = new Set(state.selectedItemIds); selectedItemIds.add(itemId);
    const hardCoverage = new Set(state.hardCoverage); for (const key of optionHardKeys(option)) hardCoverage.add(key);
    const subjectCounts = new Map(state.subjectCounts), subjectId = id(option.item.primarySubjectId);
    subjectCounts.set(subjectId, (subjectCounts.get(subjectId) || 0) + 1);
    const preferenceCoverageCounts = new Map(state.preferenceCoverageCounts);
    for (const match of option.preferenceMatches || []) if ((Number(match.score) || 0) > 0) preferenceCoverageCounts.set(match.key, (preferenceCoverageCounts.get(match.key) || 0) + 1);
    return {
      selectedItemIds, visitedTargetIds, hardCoverage, hardCovered: hardCoverage.size,
      currentTargetId, currentVenueId, currentPlaceId, currentAnchorId,
      entries: [...state.entries, { _id: entryId, option, deliveryAnchorId }], anchors, legs,
      elapsedSeconds: nextElapsed,
      contentSeconds: state.contentSeconds + Number(option.targetSeconds || 0),
      observationSeconds: state.observationSeconds + observationSeconds,
      logisticsSeconds: state.logisticsSeconds + Number(route.estimatedSeconds || 0),
      explicitScore: state.explicitScore + preferenceGain(state, option),
      utility: state.utility + nonExplicitGain(state, option, Number(route.estimatedSeconds || 0), createsAnchor),
      subjectCounts, preferenceCoverageCounts, lastOption: option,
    };
  }

  let beam = [emptyState()];
  const uniqueItemCount = new Set(options.map((option) => id(option.item._id))).size;
  const maxEntries = context.coverageGoal === "all" ? uniqueItemCount : Math.min(policy.generator.maxContentEntries, Math.max(1, uniqueItemCount));
  for (let depth = 0; depth < maxEntries; depth += 1) {
    const expanded = [...beam];
    for (const state of beam) {
      const remaining = options
        .filter((option) => !state.selectedItemIds.has(id(option.item._id)))
        .sort((a, b) => optionHardKeys(b).filter((key) => !state.hardCoverage.has(key)).length - optionHardKeys(a).filter((key) => !state.hardCoverage.has(key)).length
          || Number(b.explicitPreference || 0) - Number(a.explicitPreference || 0)
          || Number(b.baseUtility || 0) - Number(a.baseUtility || 0))
        .slice(0, policy.generator.branchCandidates + requiredCount);
      for (const option of remaining) {
        const next = appendOption(state, option);
        if (next) expanded.push(next);
      }
    }
    const nextBeam = pruneBeam(expanded, requiredCount, policy.generator.beamWidth);
    if (nextBeam.every((state) => state.entries.length <= depth)) break;
    beam = nextBeam;
  }

  const finals = beam
    .filter((state) => state.entries.length > 0 && state.anchors.length > 0 && state.hardCovered === requiredCount)
    .sort((a, b) => compareStates(a, b, requiredCount));
  const best = finals[0];
  if (!best) {
    throw new AppError("I vincoli richiesti non sono compatibili con tempo, contenuti o PhysicalScope", 409, [{ field: "timeBudgetSeconds", code: "GENERATION_CONSTRAINT_CONFLICT", message: "Nessun piano fattibile soddisfa tutti i vincoli hard" }]);
  }
  return {
    best,
    reservedSeconds,
    searchDiagnostics: {
      beamFoundFeasible: true,
      hardRequirementCount: requiredCount,
      selectedItemCount: best.entries.length,
      selectedAnchorCount: best.anchors.length,
    },
  };
}

module.exports = { optimizeVisitV2, transferKey, compareStates, pruneBeam };
