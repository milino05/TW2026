function id(value) { return String(value?._id || value?.id || value || ""); }

function signalMap(values = []) {
  const result = new Map();
  for (const value of values || []) {
    const definitionId = String(value?.definitionId || "");
    if (!definitionId) continue;
    const weight = Math.max(0, Math.min(1, Number(value?.weight ?? 1)));
    result.set(definitionId, Math.max(result.get(definitionId) || 0, weight));
  }
  return result;
}

function effectiveSignalWeight(candidate, definitionId) {
  const intrinsic = signalMap(candidate?.revision?.selectionSignals).get(String(definitionId)) || 0;
  const contextual = signalMap(candidate?.curationSignals).get(String(definitionId)) || 0;
  return Math.max(intrinsic, contextual);
}

function scoreCandidate(candidate, preferences = []) {
  return (preferences || []).reduce((total, preference) => {
    const preferenceWeight = Math.max(0, Math.min(1, Number(preference?.weight ?? 1)));
    return total + preferenceWeight * effectiveSignalWeight(candidate, preference?.definitionId);
  }, 0);
}

function stableCandidateKey(candidate) {
  return [
    id(candidate?.item?._id || candidate?.itemId),
    id(candidate?.edition?._id || candidate?.itemEditionId),
    id(candidate?.revision?._id || candidate?.itemRevisionId),
  ].join(":");
}

function deduplicateCandidates(candidates = []) {
  const byKey = new Map();
  for (const candidate of candidates || []) {
    const key = stableCandidateKey(candidate);
    if (!key.replaceAll(":", "")) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...candidate,
        curationSignals: [...(candidate.curationSignals || [])],
        sourceEditorialReleaseIds: [...new Set((candidate.sourceEditorialReleaseIds || [candidate.sourceEditorialReleaseId]).map(id).filter(Boolean))],
      });
      continue;
    }
    const merged = signalMap([...(existing.curationSignals || []), ...(candidate.curationSignals || [])]);
    existing.curationSignals = [...merged].map(([definitionId, weight]) => ({ definitionId, weight }));
    existing.sourceEditorialReleaseIds = [...new Set([
      ...(existing.sourceEditorialReleaseIds || []),
      ...(candidate.sourceEditorialReleaseIds || []),
      candidate.sourceEditorialReleaseId,
    ].map(id).filter(Boolean))].sort();
  }
  return [...byKey.values()].sort((left, right) => stableCandidateKey(left).localeCompare(stableCandidateKey(right)));
}

function resolveCandidatesForSubject({ candidates = [], preferences = [] }) {
  const unique = deduplicateCandidates(candidates);
  if (!unique.length) return { status: "unavailable", candidates: [], score: 0 };
  if (unique.length === 1) return { status: "resolved", candidates: unique, selected: unique[0], score: scoreCandidate(unique[0], preferences) };

  const scored = unique.map((candidate) => ({ candidate, score: scoreCandidate(candidate, preferences) }));
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  if (bestScore <= 0) return { status: "ambiguous", candidates: unique, score: 0 };
  const epsilon = 1e-9;
  const best = scored.filter((entry) => Math.abs(entry.score - bestScore) <= epsilon).map((entry) => entry.candidate);
  if (best.length === 1) return { status: "resolved", candidates: unique, selected: best[0], score: bestScore };
  return { status: "ambiguous", candidates: best, score: bestScore };
}

function relationPreferences(relationType, direction = "forward") {
  return direction === "reverse"
    ? relationType?.reverse?.targetSelectionSignals || []
    : relationType?.targetSelectionSignals || [];
}

function resolveSemanticRelationTargets({ targets = [], relationType, direction = "forward" }) {
  const preferences = relationPreferences(relationType, direction);
  const resolvedTargets = (targets || []).map((target) => ({
    ...target,
    resolution: resolveCandidatesForSubject({ candidates: target.candidates || [], preferences }),
  }));
  const available = resolvedTargets.filter((target) => target.resolution.status !== "unavailable");
  if (!available.length) return { status: "unavailable", targets: resolvedTargets, preferences };

  // Cardinality belongs to the semantic graph, not to Item ranking. If a relation reaches
  // multiple Subjects (for example multiple authors), keep every target explicit.
  if (available.length !== 1) return { status: "ambiguous", targets: available, preferences };
  const only = available[0];
  if (only.resolution.status === "resolved") {
    return { status: "resolved", targets: available, selected: only.resolution.selected, preferences };
  }
  return { status: "ambiguous", targets: available, preferences };
}

module.exports = {
  effectiveSignalWeight,
  scoreCandidate,
  deduplicateCandidates,
  resolveCandidatesForSubject,
  relationPreferences,
  resolveSemanticRelationTargets,
};
