const { randomUUID } = require("crypto");

const DEFINITION_FIELDS = Object.freeze([
  "placeTypes",
  "connectionTypes",
  "physicalAttributes",
  "routingProfiles",
]);

function plain(value) {
  return value?.toObject ? value.toObject() : value;
}

function clone(value) {
  const source = plain(value);
  if (Array.isArray(source)) return source.map(clone);
  if (!source || typeof source !== "object") return source;
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, clone(entry)]));
}

function ensureDefinitionIds(payload = {}) {
  const result = { ...payload };
  for (const field of DEFINITION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || !Array.isArray(payload[field])) continue;
    result[field] = payload[field].map((definition) => {
      const copied = clone(definition);
      if (!copied || typeof copied !== "object" || Array.isArray(copied)) return copied;
      return { ...copied, definitionId: copied.definitionId || randomUUID() };
    });
  }
  return result;
}

function regenerateDefinitionIdsForFork(snapshot = {}) {
  const source = plain(snapshot) || {};
  const result = {};
  const idMap = new Map();

  for (const field of DEFINITION_FIELDS) {
    result[field] = (source[field] || []).map((definition) => {
      const copied = clone(definition);
      const nextId = randomUUID();
      if (copied?.definitionId) idMap.set(String(copied.definitionId), nextId);
      return { ...copied, definitionId: nextId };
    });
  }

  result.routingProfiles = (result.routingProfiles || []).map((profile) => ({
    ...profile,
    requirements: (profile.requirements || []).map((requirement) => ({
      ...requirement,
      physicalAttributeDefinitionId: idMap.get(String(requirement.physicalAttributeDefinitionId))
        || requirement.physicalAttributeDefinitionId,
    })),
  }));

  return { snapshot: result, idMap };
}

module.exports = {
  DEFINITION_FIELDS,
  ensureDefinitionIds,
  regenerateDefinitionIdsForFork,
};
