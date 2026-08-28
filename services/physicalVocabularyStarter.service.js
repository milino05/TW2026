const { randomUUID } = require("crypto");
const starter = require("../config/physicalVocabularyStarter");

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function semanticSignature(reference) {
  return `${String(reference?.scheme || "").toLowerCase()}::${String(reference?.id || "")}`;
}

function findMatches(definitions, template) {
  const exactSemanticRefs = new Set((template.semanticRefs || [])
    .filter((reference) => (reference.matchType || "exact") === "exact")
    .map(semanticSignature));
  const keyMatch = definitions.find((definition) => template.key && definition.key === template.key) || null;
  const semanticMatches = exactSemanticRefs.size
    ? definitions.filter((definition) => (definition.semanticRefs || []).some((reference) => (
      (reference.matchType || "exact") === "exact" && exactSemanticRefs.has(semanticSignature(reference))
    )))
    : [];
  return { keyMatch, semanticMatches };
}

function starterConflict(field, template, code, matches) {
  return {
    field,
    code,
    starterKey: template.key,
    starterLabel: template.label,
    matchingDefinitions: matches.map((definition) => ({
      definitionId: definition.definitionId,
      key: definition.key || null,
      label: definition.label,
    })),
  };
}

function mergeDefinitions(field, existing, templates) {
  const merged = (existing || []).map(clone);
  const added = [];
  const conflicts = [];
  const resolvedByTemplateKey = new Map();
  for (const template of templates) {
    const { keyMatch, semanticMatches } = findMatches(merged, template);
    if (keyMatch) {
      if (template.key) resolvedByTemplateKey.set(template.key, keyMatch);
      const competingMatches = semanticMatches.filter((definition) => definition !== keyMatch);
      if (competingMatches.length) {
        conflicts.push(starterConflict(field, template, "STARTER_SEMANTIC_MATCH_AMBIGUOUS", [keyMatch, ...competingMatches]));
      }
      continue;
    }
    if (semanticMatches.length) {
      if (template.key && semanticMatches.length === 1) resolvedByTemplateKey.set(template.key, semanticMatches[0]);
      conflicts.push(starterConflict(
        field,
        template,
        semanticMatches.length > 1 ? "STARTER_SEMANTIC_MATCH_AMBIGUOUS" : "STARTER_SEMANTIC_MATCH_DIFFERENT_KEY",
        semanticMatches,
      ));
      continue;
    }
    const definition = { ...clone(template), definitionId: randomUUID() };
    merged.push(definition);
    added.push(definition);
    if (template.key) resolvedByTemplateKey.set(template.key, definition);
  }
  return { merged, added, conflicts, resolvedByTemplateKey };
}

function applyPhysicalStarter(snapshot = {}) {
  const placeTypes = mergeDefinitions("placeTypes", snapshot.placeTypes, starter.PLACE_TYPES);
  const connectionTypes = mergeDefinitions("connectionTypes", snapshot.connectionTypes, starter.CONNECTION_TYPES);
  const physicalAttributes = mergeDefinitions("physicalAttributes", snapshot.physicalAttributes, starter.PHYSICAL_ATTRIBUTES);
  const unresolvedProfileConflicts = [];
  const profileTemplates = starter.ROUTING_PROFILES.flatMap((profile) => {
    const missingAttributeKeys = (profile.requirements || [])
      .map((requirement) => requirement.attributeKey)
      .filter((key) => !physicalAttributes.resolvedByTemplateKey.has(key));
    if (missingAttributeKeys.length) {
      const existingProfile = findMatches(snapshot.routingProfiles || [], profile);
      if (!existingProfile.keyMatch && !existingProfile.semanticMatches.length) {
        unresolvedProfileConflicts.push({
          field: "routingProfiles",
          code: "STARTER_DEPENDENCY_UNRESOLVED",
          starterKey: profile.key,
          starterLabel: profile.label,
          physicalAttributeKeys: [...new Set(missingAttributeKeys)],
          matchingDefinitions: [],
        });
      }
      return [];
    }
    return [{
      ...clone(profile),
      requirements: (profile.requirements || []).map(({ attributeKey, ...requirement }) => ({
        ...requirement,
        physicalAttributeDefinitionId: physicalAttributes.resolvedByTemplateKey.get(attributeKey).definitionId,
      })),
    }];
  });
  const routingProfiles = mergeDefinitions("routingProfiles", snapshot.routingProfiles, profileTemplates);

  return {
    snapshot: {
      placeTypes: placeTypes.merged,
      connectionTypes: connectionTypes.merged,
      physicalAttributes: physicalAttributes.merged,
      routingProfiles: routingProfiles.merged,
    },
    applied: {
      starterVersion: starter.STARTER_VERSION,
      placeTypesAdded: placeTypes.added.length,
      connectionTypesAdded: connectionTypes.added.length,
      physicalAttributesAdded: physicalAttributes.added.length,
      routingProfilesAdded: routingProfiles.added.length,
    },
    conflicts: [
      ...placeTypes.conflicts,
      ...connectionTypes.conflicts,
      ...physicalAttributes.conflicts,
      ...routingProfiles.conflicts,
      ...unresolvedProfileConflicts,
    ],
  };
}

module.exports = { applyPhysicalStarter };
