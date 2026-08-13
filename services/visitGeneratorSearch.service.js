const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { resolveRoute } = require("./graphRouting.service");
const { id, relationCoherence, pruneBeam } = require("./visitGeneratorSemantics.service");
const { newObjectId } = require("./physicalRoute.service");

function optimizeVisit({ options, context, layoutRevision, requirements = [], learnedResidualByConnection = new Map(), startPlaceId = null }) {
  const mustInclude = new Set((context.mustIncludeItemIds || []).map(id));
  const mustVisit = new Set((context.mustVisitItemIds || []).map(id));
  const includeAvailable = new Set(options.map((option) => id(option.item._id)));
  const visitAvailable = new Set(options.filter((option) => option.spatialMode === "target").map((option) => id(option.item._id)));
  const missingInclude = [...mustInclude].filter((itemId) => !includeAvailable.has(itemId));
  const missingVisit = [...mustVisit].filter((itemId) => !visitAvailable.has(itemId));
  if (missingInclude.length || missingVisit.length) {
    throw new AppError("Alcuni vincoli di inclusione non sono soddisfacibili", 409, [
      ...missingInclude.map((itemId) => ({ field: "mustIncludeItemIds", code: "MUST_INCLUDE_UNAVAILABLE", message: `Item non includibile: ${itemId}` })),
      ...missingVisit.map((itemId) => ({ field: "mustVisitItemIds", code: "MUST_VISIT_UNAVAILABLE", message: `Item non visitabile fisicamente: ${itemId}` })),
    ]);
  }
  const totalMust = mustInclude.size + mustVisit.size;
  const routeCache = new Map();
  function routeBetween(fromPlaceId, toPlaceId) {
    if (!fromPlaceId) return { reachable: true, path: [], estimatedSeconds: 0, preferencePenalty: 0 };
    if (!layoutRevision) return { reachable: false };
    const key = `${id(fromPlaceId)}>${id(toPlaceId)}`;
    if (!routeCache.has(key)) routeCache.set(key, resolveRoute({ connections: layoutRevision.connections, fromPlaceId, toPlaceId, requirements, speedMps: context.effectiveMovementSpeedMps, learnedResidualByConnection }));
    return routeCache.get(key);
  }
  const reserveRatio = policy.generator.conservativeTimeReserveRatio * (1 - context.dimensions.timeRisk.value);
  const reservedSeconds = Math.round(context.timeBudgetSeconds * reserveRatio);
  const usableBudget = Math.max(1, context.timeBudgetSeconds - reservedSeconds);

  function emptyState() {
    const startAnchor = startPlaceId ? { _id: newObjectId(), kind: "place", purpose: "start", contentEntryId: null, itemId: null, museumId: context.museumId, placeId: startPlaceId, estimatedObservationSeconds: 0 } : null;
    return { selectedItemIds: new Set(), currentPlaceId: startPlaceId, currentAnchorId: startAnchor?._id || null, entries: [], anchors: startAnchor ? [startAnchor] : [], legs: [], elapsedSeconds: 0, contentSeconds: 0, observationSeconds: 0, logisticsSeconds: 0, utility: 0, mustCovered: 0, itemTypeCounts: new Map(), coverageCounts: new Map(), lastOption: null };
  }
  function gainFor(state, option, routeSeconds) {
    const sameTypeCount = state.itemTypeCounts.get(option.item.itemType) || 0;
    const diversityPenalty = Math.max(0, sameTypeCount - 1) * 0.18;
    const coherence = relationCoherence(state.lastOption, option);
    const keys = option.coverageKeys || [];
    const coverageFactor = keys.length ? keys.reduce((sum, key) => sum + 1 / (1 + (state.coverageCounts.get(key) || 0)), 0) / keys.length : 1;
    const explicit = (Number(option.explicitUtility) || 0) > 0 ? option.explicitUtility * coverageFactor : (Number(option.explicitUtility) || 0);
    const logisticsPenalty = (routeSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
    return (Number(option.nonExplicitUtility) || 0) + explicit + coherence - diversityPenalty - logisticsPenalty;
  }
  function appendOption(state, option) {
    if (state.selectedItemIds.has(id(option.item._id))) return null;
    let route = { reachable: true, path: [], estimatedSeconds: 0, preferencePenalty: 0 };
    if (option.spatialMode === "target") {
      if (!option.placement?.primaryPlaceId) return null;
      route = routeBetween(state.currentPlaceId, option.placement.primaryPlaceId);
      if (!route.reachable) return null;
    }
    const observation = option.spatialMode === "target" ? (Number(option.observationSeconds) || 0) : 0;
    const nextElapsed = state.elapsedSeconds + (Number(option.targetSeconds) || 0) + observation + route.estimatedSeconds;
    if (context.hardTimeBudget && nextElapsed > usableBudget) return null;
    const entryId = newObjectId();
    let deliveryAnchorId = state.currentAnchorId, currentPlaceId = state.currentPlaceId, currentAnchorId = state.currentAnchorId;
    const anchors = [...state.anchors], legs = [...state.legs];
    if (option.spatialMode === "target") {
      const anchor = { _id: newObjectId(), kind: "content_target", purpose: "content", contentEntryId: entryId, itemId: option.item._id, museumId: context.museumId, placeId: option.placement.primaryPlaceId, estimatedObservationSeconds: Math.round(observation) };
      if (state.currentAnchorId) legs.push({ _id: newObjectId(), type: "indoor", fromAnchorId: state.currentAnchorId, toAnchorId: anchor._id, layoutRevisionId: layoutRevision?._id || null, path: (route.path || []).map((entry) => entry.connectionId || entry), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0, instruction: null, communityNote: null });
      anchors.push(anchor);
      deliveryAnchorId = anchor._id;
      currentPlaceId = anchor.placeId;
      currentAnchorId = anchor._id;
    }
    const selected = new Set(state.selectedItemIds); selected.add(id(option.item._id));
    const counts = new Map(state.itemTypeCounts); counts.set(option.item.itemType, (counts.get(option.item.itemType) || 0) + 1);
    const coverage = new Map(state.coverageCounts); for (const key of option.coverageKeys || []) coverage.set(key, (coverage.get(key) || 0) + 1);
    const itemId = id(option.item._id);
    const covered = (mustInclude.has(itemId) ? 1 : 0) + (option.spatialMode === "target" && mustVisit.has(itemId) ? 1 : 0);
    return { selectedItemIds: selected, currentPlaceId, currentAnchorId, entries: [...state.entries, { _id: entryId, option, deliveryAnchorId }], anchors, legs, elapsedSeconds: nextElapsed, contentSeconds: state.contentSeconds + option.targetSeconds, observationSeconds: state.observationSeconds + observation, logisticsSeconds: state.logisticsSeconds + route.estimatedSeconds, utility: state.utility + gainFor(state, option, route.estimatedSeconds), mustCovered: state.mustCovered + covered, itemTypeCounts: counts, coverageCounts: coverage, lastOption: option };
  }
  function finalize(state) {
    if (!context.endPlaceId) return state;
    const route = routeBetween(state.currentPlaceId, context.endPlaceId);
    if (!route.reachable) return null;
    const elapsedSeconds = state.elapsedSeconds + route.estimatedSeconds;
    if (context.hardTimeBudget && elapsedSeconds > usableBudget) return null;
    const end = { _id: newObjectId(), kind: "place", purpose: "end", contentEntryId: null, itemId: null, museumId: context.museumId, placeId: context.endPlaceId, estimatedObservationSeconds: 0 };
    const legs = [...state.legs];
    if (state.currentAnchorId) legs.push({ _id: newObjectId(), type: "indoor", fromAnchorId: state.currentAnchorId, toAnchorId: end._id, layoutRevisionId: layoutRevision?._id || null, path: (route.path || []).map((entry) => entry.connectionId || entry), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0, instruction: null, communityNote: null });
    return { ...state, currentPlaceId: context.endPlaceId, currentAnchorId: end._id, anchors: [...state.anchors, end], legs, elapsedSeconds, logisticsSeconds: state.logisticsSeconds + route.estimatedSeconds, utility: state.utility - (route.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight };
  }
  function evaluateOrder(orderedOptions) {
    let state = emptyState();
    for (const option of orderedOptions) { state = appendOption(state, option); if (!state) return null; }
    if (state.mustCovered !== totalMust) return null;
    return finalize(state);
  }

  let beam = [emptyState()];
  const maxEntries = Math.min(policy.generator.maxContentEntries, Math.max(1, new Set(options.map((option) => id(option.item._id))).size));
  for (let depth = 0; depth < maxEntries; depth += 1) {
    const expanded = [...beam];
    for (const state of beam) {
      const remaining = options.filter((option) => !state.selectedItemIds.has(id(option.item._id))).sort((a, b) => {
        const priority = (option) => (mustInclude.has(id(option.item._id)) ? 1 : 0) + (option.spatialMode === "target" && mustVisit.has(id(option.item._id)) ? 1 : 0);
        return priority(b) - priority(a) || b.baseUtility - a.baseUtility;
      }).slice(0, policy.generator.branchCandidates + totalMust);
      for (const option of remaining) { const next = appendOption(state, option); if (next) expanded.push(next); }
    }
    const nextBeam = pruneBeam(expanded, totalMust, policy.generator.beamWidth);
    if (nextBeam.every((state) => state.entries.length <= depth)) break;
    beam = nextBeam;
  }
  let finals = beam.filter((state) => state.entries.length > 0 && state.mustCovered === totalMust).map(finalize).filter(Boolean);
  finals.sort((a, b) => b.utility - a.utility || b.entries.length - a.entries.length || a.elapsedSeconds - b.elapsedSeconds);
  let best = finals[0];
  if (!best) throw new AppError("I vincoli richiesti non sono compatibili con il tempo disponibile", 409, [{ field: "timeBudgetSeconds", code: "GENERATION_CONSTRAINT_CONFLICT", message: "Aumentare il tempo o ridurre i vincoli di inclusione" }]);

  function blockOrder(entries) {
    const intro = [], groups = []; let current = null;
    for (const entry of entries) {
      const option = entry.option;
      if (option.spatialMode === "target") { current = [option]; groups.push(current); }
      else if (current) current.push(option); else intro.push(option);
    }
    return { intro, groups };
  }
  for (let pass = 0; pass < policy.generator.localImprovementPasses; pass += 1) {
    const { intro, groups } = blockOrder(best.entries); let improved = best;
    for (let left = 0; left < groups.length - 1; left += 1) for (let right = left + 1; right < groups.length; right += 1) {
      const reorderedGroups = [...groups.slice(0, left), ...groups.slice(left, right + 1).reverse(), ...groups.slice(right + 1)];
      const candidate = evaluateOrder([...intro, ...reorderedGroups.flat()]);
      if (candidate && (candidate.utility > improved.utility + 1e-9 || (Math.abs(candidate.utility - improved.utility) < 1e-9 && candidate.elapsedSeconds < improved.elapsedSeconds))) improved = candidate;
    }
    if (improved === best) break; best = improved;
  }
  return { best, reservedSeconds };
}

module.exports = { optimizeVisit };
