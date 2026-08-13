const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { resolveRoute } = require("./graphRouting.service");
const { id, relationCoherence, pruneBeam } = require("./visitGeneratorSemantics.service");

function optimizeVisit({ options, context, layoutRevision, requirements, learnedResidualByConnection, startPlaceId }) {
  const must = new Set(context.mustSeeItemIds.map(id));
  const availableItems = new Set(options.map((option) => id(option.item._id)));
  const missingMust = [...must].filter((itemId) => !availableItems.has(itemId));
  if (missingMust.length) {
    throw new AppError("Alcuni must-see non sono disponibili come tappe visitabili", 409, missingMust.map((itemId) => ({
      field: "mustSeeItemIds",
      code: "MUST_SEE_UNAVAILABLE",
      message: `Item non disponibile: ${itemId}`,
    })));
  }

  const routeCache = new Map();
  function routeBetween(fromPlaceId, toPlaceId) {
    if (!fromPlaceId) return { reachable: true, path: [], estimatedSeconds: 0, preferencePenalty: 0 };
    const key = `${id(fromPlaceId)}>${id(toPlaceId)}`;
    if (!routeCache.has(key)) {
      routeCache.set(key, resolveRoute({
        connections: layoutRevision.connections,
        fromPlaceId,
        toPlaceId,
        requirements,
        speedMps: context.effectiveMovementSpeedMps,
        learnedResidualByConnection,
      }));
    }
    return routeCache.get(key);
  }

  const reserveRatio = policy.generator.conservativeTimeReserveRatio * (1 - context.dimensions.timeRisk.value);
  const reservedSeconds = Math.round(context.timeBudgetSeconds * reserveRatio);
  const usableBudget = Math.max(1, context.timeBudgetSeconds - reservedSeconds);
  let beam = [{
    selectedItemIds: new Set(),
    currentPlaceId: startPlaceId,
    stops: [],
    transitions: [],
    elapsedSeconds: 0,
    contentSeconds: 0,
    observationSeconds: 0,
    logisticsSeconds: 0,
    utility: 0,
    mustCovered: 0,
    itemTypeCounts: new Map(),
    lastOption: null,
  }];
  const maxStops = Math.min(policy.generator.maxStops, Math.max(1, options.length));

  for (let depth = 0; depth < maxStops; depth += 1) {
    const expanded = [...beam];
    for (const state of beam) {
      const remaining = options
        .filter((option) => !state.selectedItemIds.has(id(option.item._id)))
        .sort((a, b) => {
          const aMust = must.has(id(a.item._id)) ? 1 : 0;
          const bMust = must.has(id(b.item._id)) ? 1 : 0;
          return bMust - aMust || b.baseUtility - a.baseUtility;
        })
        .slice(0, policy.generator.branchCandidates + must.size);
      for (const option of remaining) {
        const route = routeBetween(state.currentPlaceId, option.placement.primaryPlaceId);
        if (!route.reachable) continue;
        const nextElapsed = state.elapsedSeconds + route.estimatedSeconds + option.targetSeconds + option.observationSeconds;
        if (context.hardTimeBudget && nextElapsed > usableBudget) continue;
        const sameTypeCount = state.itemTypeCounts.get(option.item.itemType) || 0;
        const diversityPenalty = Math.max(0, sameTypeCount - 1) * 0.18;
        const coherence = relationCoherence(state.lastOption, option);
        const logisticsPenalty = (route.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
        const selected = new Set(state.selectedItemIds);
        selected.add(id(option.item._id));
        const counts = new Map(state.itemTypeCounts);
        counts.set(option.item.itemType, sameTypeCount + 1);
        expanded.push({
          selectedItemIds: selected,
          currentPlaceId: option.placement.primaryPlaceId,
          stops: [...state.stops, option],
          transitions: [...state.transitions, {
            fromStopIndex: state.stops.length - 1,
            toStopIndex: state.stops.length,
            fromPlaceId: state.currentPlaceId || null,
            toPlaceId: option.placement.primaryPlaceId,
            path: (route.path || []).map((entry) => entry.connectionId),
            estimatedSeconds: Math.round(route.estimatedSeconds),
            preferencePenalty: route.preferencePenalty || 0,
          }],
          elapsedSeconds: nextElapsed,
          contentSeconds: state.contentSeconds + option.targetSeconds,
          observationSeconds: state.observationSeconds + option.observationSeconds,
          logisticsSeconds: state.logisticsSeconds + route.estimatedSeconds,
          utility: state.utility + option.baseUtility + coherence - diversityPenalty - logisticsPenalty,
          mustCovered: state.mustCovered + (must.has(id(option.item._id)) ? 1 : 0),
          itemTypeCounts: counts,
          lastOption: option,
        });
      }
    }
    const nextBeam = pruneBeam(expanded, must.size, policy.generator.beamWidth);
    if (nextBeam.every((state) => state.stops.length <= depth)) break;
    beam = nextBeam;
  }

  let finals = beam.filter((state) => state.stops.length > 0 && state.mustCovered === must.size);
  if (context.endPlaceId) {
    finals = finals.filter((state) => {
      const route = routeBetween(state.currentPlaceId, context.endPlaceId);
      return route.reachable && (!context.hardTimeBudget || state.elapsedSeconds + route.estimatedSeconds <= usableBudget);
    });
  }
  finals.sort((a, b) => b.utility - a.utility || b.stops.length - a.stops.length || a.elapsedSeconds - b.elapsedSeconds);
  let best = finals[0];
  if (!best) {
    throw new AppError("I vincoli richiesti non sono compatibili con il tempo disponibile", 409, [{
      field: "timeBudgetSeconds",
      code: "GENERATION_CONSTRAINT_CONFLICT",
      message: "Ridurre i must-see, aumentare il tempo o modificare i constraint",
    }]);
  }

  function evaluateOrder(orderedStops) {
    const transitions = [];
    const counts = new Map();
    let currentPlaceId = startPlaceId;
    let logisticsSeconds = 0;
    let contentSeconds = 0;
    let observationSeconds = 0;
    let utility = 0;
    let previous = null;
    for (let index = 0; index < orderedStops.length; index += 1) {
      const option = orderedStops[index];
      const route = routeBetween(currentPlaceId, option.placement.primaryPlaceId);
      if (!route.reachable) return null;
      const sameTypeCount = counts.get(option.item.itemType) || 0;
      const diversityPenalty = Math.max(0, sameTypeCount - 1) * 0.18;
      const coherence = relationCoherence(previous, option);
      const logisticsPenalty = (route.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
      utility += option.baseUtility + coherence - diversityPenalty - logisticsPenalty;
      counts.set(option.item.itemType, sameTypeCount + 1);
      logisticsSeconds += route.estimatedSeconds;
      contentSeconds += option.targetSeconds;
      observationSeconds += option.observationSeconds;
      transitions.push({
        fromStopIndex: index - 1,
        toStopIndex: index,
        fromPlaceId: currentPlaceId || null,
        toPlaceId: option.placement.primaryPlaceId,
        path: (route.path || []).map((entry) => entry.connectionId),
        estimatedSeconds: Math.round(route.estimatedSeconds),
        preferencePenalty: route.preferencePenalty || 0,
      });
      currentPlaceId = option.placement.primaryPlaceId;
      previous = option;
    }
    if (context.endPlaceId) {
      const endRoute = routeBetween(currentPlaceId, context.endPlaceId);
      if (!endRoute.reachable) return null;
      logisticsSeconds += endRoute.estimatedSeconds;
      utility -= (endRoute.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
      transitions.push({
        fromStopIndex: orderedStops.length - 1,
        toStopIndex: orderedStops.length,
        fromPlaceId: currentPlaceId,
        toPlaceId: context.endPlaceId,
        path: (endRoute.path || []).map((entry) => entry.connectionId),
        estimatedSeconds: Math.round(endRoute.estimatedSeconds),
        preferencePenalty: endRoute.preferencePenalty || 0,
      });
      currentPlaceId = context.endPlaceId;
    }
    const elapsedSeconds = contentSeconds + observationSeconds + logisticsSeconds;
    if (context.hardTimeBudget && elapsedSeconds > usableBudget) return null;
    return {
      selectedItemIds: new Set(orderedStops.map((option) => id(option.item._id))),
      currentPlaceId,
      stops: orderedStops,
      transitions,
      elapsedSeconds,
      contentSeconds,
      observationSeconds,
      logisticsSeconds,
      utility,
      mustCovered: orderedStops.filter((option) => must.has(id(option.item._id))).length,
      itemTypeCounts: counts,
      lastOption: orderedStops.at(-1) || null,
    };
  }

  const initialOrdered = evaluateOrder(best.stops);
  if (initialOrdered) best = initialOrdered;
  for (let pass = 0; pass < policy.generator.localImprovementPasses; pass += 1) {
    let improved = best;
    for (let left = 0; left < best.stops.length - 1; left += 1) {
      for (let right = left + 1; right < best.stops.length; right += 1) {
        const reordered = [...best.stops.slice(0, left), ...best.stops.slice(left, right + 1).reverse(), ...best.stops.slice(right + 1)];
        const candidate = evaluateOrder(reordered);
        if (!candidate) continue;
        if (candidate.utility > improved.utility + 1e-9 || (Math.abs(candidate.utility - improved.utility) < 1e-9 && candidate.elapsedSeconds < improved.elapsedSeconds)) improved = candidate;
      }
    }
    if (improved === best) break;
    best = improved;
  }
  return { best, reservedSeconds };
}

module.exports = { optimizeVisit };
