const { semanticSignature, exactSemanticRefs } = require("./physicalVocabularyResolver.service");

function id(value) { return String(value?._id || value || ""); }
function optionValues(definition) { return (definition?.options || []).map((option) => String(option.value)).sort(); }
function sameOptions(left, right) {
  const a = optionValues(left), b = optionValues(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function definitionsCompatible(left, right) {
  if (!left || !right) return false;
  if (left.dataType !== right.dataType) return false;
  if ((left.unit || null) !== (right.unit || null)) return false;
  if (left.dataType === "choice" && !sameOptions(left, right)) return false;
  return true;
}
function routingControl(definition, physicalFeatureRef, key) {
  return {
    key,
    label: definition.label,
    description: definition.description || "",
    dataType: definition.dataType,
    unit: definition.unit || null,
    options: definition.options || [],
    recommendedOperator: definition.metadata?.recommendedOperator || (definition.dataType === "number" ? "gte" : "eq"),
    physicalFeatureRef,
  };
}
function profileRequirementSummary(requirement, attributeById) {
  const attribute = attributeById.get(String(requirement.physicalAttributeDefinitionId));
  return {
    label: attribute?.label || "Caratteristica fisica",
    operator: requirement.operator || "eq",
    value: requirement.value,
    priority: requirement.priority || "preferred",
  };
}
function profileProjection(revision) {
  const attributeById = new Map((revision?.physicalAttributes || []).map((definition) => [definition.definitionId, definition]));
  return (revision?.routingProfiles || []).map((profile) => ({
    definitionId: profile.definitionId,
    label: profile.label,
    description: profile.description || "",
    requirements: (profile.requirements || []).map((requirement) => profileRequirementSummary(requirement, attributeById)),
  }));
}
function exactAttributeIndex(revision) {
  const index = new Map();
  for (const definition of revision?.physicalAttributes || []) {
    for (const semanticRef of exactSemanticRefs(definition.semanticRefs || [])) {
      const signature = semanticSignature(semanticRef);
      const existing = index.get(signature);
      if (existing === undefined) index.set(signature, { definition, semanticRef });
      else index.set(signature, null);
    }
  }
  return index;
}
function projectFederatedControls(selectedRevisions) {
  if (!selectedRevisions.length) return [];
  if (selectedRevisions.length === 1) {
    const revision = selectedRevisions[0];
    return (revision.physicalAttributes || []).map((definition) => routingControl(definition, {
      kind: "local",
      physicalVocabularyId: revision.physicalVocabularyId,
      definitionId: definition.definitionId,
    }, definition.definitionId));
  }
  const indexes = selectedRevisions.map(exactAttributeIndex);
  const controls = [];
  for (const [signature, first] of indexes[0]) {
    if (!first) continue;
    const matches = indexes.map((index) => index.get(signature));
    if (matches.some((match) => !match)) continue;
    if (!matches.every((match) => definitionsCompatible(first.definition, match.definition))) continue;
    controls.push(routingControl(first.definition, {
      kind: "semantic",
      semanticRefs: [{
        scheme: first.semanticRef.scheme,
        id: first.semanticRef.id,
        matchType: "exact",
      }],
    }, signature));
  }
  return controls;
}
function projectRoutingNavigationOptions({ selectedVenueIds = [], layoutByVenueId = new Map(), revisionById = new Map() }) {
  const selected = selectedVenueIds.map(String);
  const revisionForVenue = new Map();
  for (const venueId of selected) {
    const layout = layoutByVenueId.get(venueId);
    const revision = layout ? revisionById.get(id(layout.authoredAgainstPhysicalVocabularyRevisionId)) : null;
    if (revision) revisionForVenue.set(venueId, revision);
  }
  if (revisionForVenue.size !== selected.length) return { requirements: [], profilesByVenue: [] };
  const selectedRevisions = selected.map((venueId) => revisionForVenue.get(venueId));
  return {
    requirements: projectFederatedControls(selectedRevisions),
    profilesByVenue: selected.map((venueId) => {
      const revision = revisionForVenue.get(venueId);
      return {
        venueId,
        physicalVocabularyRevisionId: revision._id,
        profiles: profileProjection(revision),
      };
    }),
  };
}

module.exports = {
  definitionsCompatible,
  exactAttributeIndex,
  profileProjection,
  projectFederatedControls,
  projectRoutingNavigationOptions,
};
