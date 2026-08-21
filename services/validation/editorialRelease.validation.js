const mongoose = require("mongoose");
const { isPlainObject, trimIfString } = require("./validation.utils");

function normalizeEditorialReleasePayload(payload = {}) {
  return {
    namespaceRevisionId: payload.namespaceRevisionId || null,
    graphRevisionId: payload.graphRevisionId || null,
    itemBindings: Array.isArray(payload.itemBindings)
      ? payload.itemBindings.map((binding) => ({
          itemEditionId: binding?.itemEditionId,
          itemRevisionId: binding?.itemRevisionId,
          curationSignals: Array.isArray(binding?.curationSignals)
            ? binding.curationSignals.map((signal) => ({ definitionId: trimIfString(signal?.definitionId), weight: signal?.weight === undefined ? 1 : Number(signal.weight) }))
            : binding?.curationSignals,
        }))
      : payload.itemBindings,
  };
}

function validateEditorialReleasePayload(rawPayload = {}) {
  const issues = [];
  const allowed = ["namespaceRevisionId", "graphRevisionId", "itemBindings"];
  for (const key of Object.keys(rawPayload || {})) {
    if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  }
  if (!mongoose.isValidObjectId(rawPayload.namespaceRevisionId)) issues.push({ field: "namespaceRevisionId", code: "INVALID_OBJECT_ID", message: "namespaceRevisionId non valido" });
  if (rawPayload.graphRevisionId && !mongoose.isValidObjectId(rawPayload.graphRevisionId)) issues.push({ field: "graphRevisionId", code: "INVALID_OBJECT_ID", message: "graphRevisionId non valido" });
  if (!Array.isArray(rawPayload.itemBindings)) issues.push({ field: "itemBindings", code: "INVALID_TYPE", message: "itemBindings deve essere un array" });

  const seenEditions = new Set();
  for (const [index, binding] of (rawPayload.itemBindings || []).entries()) {
    const base = `itemBindings[${index}]`;
    if (!isPlainObject(binding)) { issues.push({ field: base, code: "INVALID_TYPE", message: "Binding non valido" }); continue; }
    if (!mongoose.isValidObjectId(binding.itemEditionId)) issues.push({ field: `${base}.itemEditionId`, code: "INVALID_OBJECT_ID", message: "itemEditionId non valido" });
    if (!mongoose.isValidObjectId(binding.itemRevisionId)) issues.push({ field: `${base}.itemRevisionId`, code: "INVALID_OBJECT_ID", message: "itemRevisionId non valido" });
    const editionKey = String(binding.itemEditionId || "");
    if (editionKey && seenEditions.has(editionKey)) issues.push({ field: `${base}.itemEditionId`, code: "DUPLICATE_VALUE", message: "Una ItemEdition puo comparire una sola volta nella Release" });
    seenEditions.add(editionKey);
    if (binding.curationSignals !== undefined && !Array.isArray(binding.curationSignals)) issues.push({ field: `${base}.curationSignals`, code: "INVALID_TYPE", message: "curationSignals deve essere un array" });
    const seenSignals = new Set();
    for (const [signalIndex, signal] of (binding.curationSignals || []).entries()) {
      const signalBase = `${base}.curationSignals[${signalIndex}]`;
      if (!isPlainObject(signal) || !signal.definitionId || typeof signal.definitionId !== "string") {
        issues.push({ field: signalBase, code: "INVALID_VALUE", message: "Curation signal non valido" });
        continue;
      }
      const key = signal.definitionId.trim();
      if (seenSignals.has(key)) issues.push({ field: `${signalBase}.definitionId`, code: "DUPLICATE_VALUE", message: "SelectionSignal duplicato" });
      seenSignals.add(key);
      if (signal.weight !== undefined && (!Number.isFinite(Number(signal.weight)) || Number(signal.weight) < 0 || Number(signal.weight) > 1)) issues.push({ field: `${signalBase}.weight`, code: "OUT_OF_RANGE", message: "weight deve essere fra 0 e 1" });
    }
  }
  return issues;
}

module.exports = { normalizeEditorialReleasePayload, validateEditorialReleasePayload };
