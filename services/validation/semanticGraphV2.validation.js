const mongoose = require("mongoose");
const { isPlainObject, trimIfString } = require("./validation.utils");

function normalizeGraphRevisionPayload(payload = {}) {
  return {
    authoredAgainstNamespaceRevisionId: payload.authoredAgainstNamespaceRevisionId || null,
    basedOnRevisionId: payload.basedOnRevisionId || null,
    subjectBindings: Array.isArray(payload.subjectBindings)
      ? payload.subjectBindings.map((entry) => ({
          subjectId: entry?.subjectId,
          subjectClassDefinitionIds: Array.isArray(entry?.subjectClassDefinitionIds)
            ? entry.subjectClassDefinitionIds.map(trimIfString)
            : entry?.subjectClassDefinitionIds,
        }))
      : payload.subjectBindings,
    edges: Array.isArray(payload.edges)
      ? payload.edges.map((entry) => ({
          sourceSubjectId: entry?.sourceSubjectId,
          targetSubjectId: entry?.targetSubjectId,
          relationTypeDefinitionId: trimIfString(entry?.relationTypeDefinitionId),
          weight: entry?.weight === undefined ? 1 : Number(entry.weight),
          metadata: entry?.metadata ?? null,
          provenance: entry?.provenance ?? { origin: "human" },
        }))
      : payload.edges,
  };
}

function validateGraphRevisionPayload(rawPayload = {}) {
  const issues = [];
  const allowed = ["authoredAgainstNamespaceRevisionId", "basedOnRevisionId", "subjectBindings", "edges"];
  for (const key of Object.keys(rawPayload || {})) {
    if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_FIELD", message: `Campo non supportato: ${key}` });
  }
  if (rawPayload.authoredAgainstNamespaceRevisionId && !mongoose.isValidObjectId(rawPayload.authoredAgainstNamespaceRevisionId)) {
    issues.push({ field: "authoredAgainstNamespaceRevisionId", code: "INVALID_OBJECT_ID", message: "NamespaceRevision non valida" });
  }
  if (rawPayload.basedOnRevisionId && !mongoose.isValidObjectId(rawPayload.basedOnRevisionId)) {
    issues.push({ field: "basedOnRevisionId", code: "INVALID_OBJECT_ID", message: "GraphRevision base non valida" });
  }
  if (!Array.isArray(rawPayload.subjectBindings)) issues.push({ field: "subjectBindings", code: "INVALID_TYPE", message: "subjectBindings deve essere un array" });
  if (!Array.isArray(rawPayload.edges)) issues.push({ field: "edges", code: "INVALID_TYPE", message: "edges deve essere un array" });

  const seenBindings = new Set();
  for (const [index, entry] of (rawPayload.subjectBindings || []).entries()) {
    const base = `subjectBindings[${index}]`;
    if (!isPlainObject(entry)) { issues.push({ field: base, code: "INVALID_TYPE", message: "Binding non valido" }); continue; }
    if (!mongoose.isValidObjectId(entry.subjectId)) issues.push({ field: `${base}.subjectId`, code: "INVALID_OBJECT_ID", message: "Subject non valido" });
    const key = String(entry.subjectId || "");
    if (key && seenBindings.has(key)) issues.push({ field: `${base}.subjectId`, code: "DUPLICATE_VALUE", message: "Subject duplicato nel graph" });
    seenBindings.add(key);
    if (!Array.isArray(entry.subjectClassDefinitionIds)) issues.push({ field: `${base}.subjectClassDefinitionIds`, code: "INVALID_TYPE", message: "subjectClassDefinitionIds deve essere un array" });
    else {
      const seen = new Set();
      entry.subjectClassDefinitionIds.forEach((definitionId, definitionIndex) => {
        if (!definitionId || typeof definitionId !== "string") issues.push({ field: `${base}.subjectClassDefinitionIds[${definitionIndex}]`, code: "INVALID_VALUE", message: "definitionId non valido" });
        else if (seen.has(definitionId.trim())) issues.push({ field: `${base}.subjectClassDefinitionIds[${definitionIndex}]`, code: "DUPLICATE_VALUE", message: "SubjectClass duplicata" });
        else seen.add(definitionId.trim());
      });
    }
  }

  const seenEdges = new Set();
  for (const [index, edge] of (rawPayload.edges || []).entries()) {
    const base = `edges[${index}]`;
    if (!isPlainObject(edge)) { issues.push({ field: base, code: "INVALID_TYPE", message: "Edge non valido" }); continue; }
    if (!mongoose.isValidObjectId(edge.sourceSubjectId)) issues.push({ field: `${base}.sourceSubjectId`, code: "INVALID_OBJECT_ID", message: "sourceSubjectId non valido" });
    if (!mongoose.isValidObjectId(edge.targetSubjectId)) issues.push({ field: `${base}.targetSubjectId`, code: "INVALID_OBJECT_ID", message: "targetSubjectId non valido" });
    if (!edge.relationTypeDefinitionId || typeof edge.relationTypeDefinitionId !== "string") issues.push({ field: `${base}.relationTypeDefinitionId`, code: "REQUIRED", message: "relationTypeDefinitionId obbligatorio" });
    if (edge.weight !== undefined && (!Number.isFinite(Number(edge.weight)) || Number(edge.weight) < 0 || Number(edge.weight) > 10)) issues.push({ field: `${base}.weight`, code: "OUT_OF_RANGE", message: "weight deve essere fra 0 e 10" });
    const signature = `${edge.sourceSubjectId || ""}::${String(edge.relationTypeDefinitionId || "").trim()}::${edge.targetSubjectId || ""}`;
    if (seenEdges.has(signature)) issues.push({ field: base, code: "DUPLICATE_VALUE", message: "Edge duplicato" });
    seenEdges.add(signature);
  }
  return issues;
}

module.exports = { normalizeGraphRevisionPayload, validateGraphRevisionPayload };
