const { randomUUID } = require("crypto");

const DEFINITION_FIELDS = Object.freeze([
  "subjectClasses",
  "relationTypes",
  "durationTypes",
  "languageLevels",
  "presentationAspects",
  "selectionSignals",
]);

function plain(value) {
  return value?.toObject ? value.toObject() : value;
}

function cloneDefinition(definition) {
  const source = plain(definition);
  return source && typeof source === "object" && !Array.isArray(source) ? { ...source } : source;
}

function ensureDefinitionIds(payload = {}) {
  const result = { ...payload };
  for (const field of DEFINITION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || !Array.isArray(payload[field])) continue;
    result[field] = payload[field].map((definition) => {
      const cloned = cloneDefinition(definition);
      if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) return cloned;
      return { ...cloned, definitionId: cloned.definitionId || randomUUID() };
    });
  }
  return result;
}

function regenerateDefinitionIdsForFork(snapshot = {}) {
  const source = plain(snapshot) || {};
  const result = {};
  const idMaps = new Map();

  for (const field of DEFINITION_FIELDS) {
    const fieldMap = new Map();
    const definitions = Array.isArray(source[field]) ? source[field] : [];
    result[field] = definitions.map((definition) => {
      const cloned = cloneDefinition(definition);
      const nextId = randomUUID();
      if (cloned?.definitionId) fieldMap.set(String(cloned.definitionId), nextId);
      return { ...cloned, definitionId: nextId };
    });
    idMaps.set(field, fieldMap);
  }

  const subjectClassMap = idMaps.get("subjectClasses") || new Map();
  result.relationTypes = (result.relationTypes || []).map((relation) => ({
    ...relation,
    domainDefinitionIds: (relation.domainDefinitionIds || []).map((definitionId) => subjectClassMap.get(String(definitionId)) || definitionId),
    rangeDefinitionIds: (relation.rangeDefinitionIds || []).map((definitionId) => subjectClassMap.get(String(definitionId)) || definitionId),
  }));

  return { snapshot: result, idMaps };
}

module.exports = {
  DEFINITION_FIELDS,
  ensureDefinitionIds,
  regenerateDefinitionIdsForFork,
};
