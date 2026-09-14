const Venue = require("../models/venue.model");
const { loadVenuePhysicalVocabulary } = require("./layoutPhysicalVocabulary.service");
const { semanticSignature, exactSemanticRefs } = require("./physicalVocabularyResolver.service");
const {
  NAVIGATION_SEMANTIC_SCHEME,
  NAVIGATION_NEED_CATALOG,
} = require("../config/navigationNeedCatalog");

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
  if ((left.appliesTo || null) !== (right.appliesTo || null)) return false;
  if (left.dataType === "choice" && !sameOptions(left, right)) return false;
  return true;
}
function canonicalScopeCompatible(actual, expected) {
  if (expected === "both") return actual === "both";
  return actual === expected || actual === "both";
}
function canonicalDefinitionCompatible(actual, expected) {
  if (!actual || !expected) return false;
  if (actual.dataType !== expected.dataType) return false;
  if ((actual.unit || null) !== (expected.unit || null)) return false;
  if (actual.dataType === "choice" && !sameOptions(actual, expected)) return false;
  return canonicalScopeCompatible(actual.appliesTo, expected.appliesTo);
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
function visitorControlProjection(definition) {
  const control = definition?.visitorControl;
  if (!control?.enabled) return null;
  return {
    definitionId: definition.definitionId,
    label: control.label || definition.label,
    description: control.description || definition.description || "",
    dataType: definition.dataType,
    unit: definition.unit || null,
    options: definition.options || [],
    valueMode: control.valueMode || "fixed",
    ...(control.valueMode === "fixed" ? { value: control.value } : {}),
  };
}
function profileRequirementSummary(requirement, attributeById) {
  const attribute = attributeById.get(String(requirement.physicalAttributeDefinitionId));
  return { label: attribute?.label || "Caratteristica fisica" };
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
function visitorControlsProjection(revision) {
  return (revision?.physicalAttributes || [])
    .map((definition) => visitorControlProjection(definition))
    .filter(Boolean);
}
function canonicalNeedSupportProjection(revision) {
  const index = exactAttributeIndex(revision);
  return NAVIGATION_NEED_CATALOG.map((need) => {
    const signature = semanticSignature({ scheme: NAVIGATION_SEMANTIC_SCHEME, id: need.id });
    const match = index.get(signature);
    return {
      id: need.id,
      supported: Boolean(match && canonicalDefinitionCompatible(match.definition, need)),
      definitionId: match?.definition?.definitionId || null,
    };
  });
}
async function projectRoutingNavigationOptions({ selectedVenueIds = [] }) {
  const selected = selectedVenueIds.map(String);
  if (!selected.length) return { requirements: [], profilesByVenue: [] };
  const venues = await Venue.find({ _id: { $in: selected }, lifecycleStatus: "active" }).lean();
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const revisionForVenue = new Map();
  for (const venueId of selected) {
    const venue = venueById.get(venueId);
    if (!venue) continue;
    try {
      const bundle = await loadVenuePhysicalVocabulary(venue, {
        requireStable: true,
        requireValidatedConsumer: Boolean(venue.publishedReleaseId),
        consumerSnapshotId: venue.publishedReleaseId || null,
      });
      revisionForVenue.set(venueId, bundle.revision.toObject ? bundle.revision.toObject() : bundle.revision);
    } catch {
      // Una Venue senza dependency fisica corrente e validata non espone controlli di routing.
    }
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
  canonicalDefinitionCompatible,
  exactAttributeIndex,
  routingControl,
  visitorControlProjection,
  visitorControlsProjection,
  canonicalNeedSupportProjection,
  profileProjection,
  projectFederatedControls,
  projectRoutingNavigationOptions,
};
