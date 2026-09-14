const { materializeSessionPhysicalPlan } = require("./physicalExecutionV2.service");
const { normalizeRoutingRequirements } = require("./routingPreferenceV2.service");
const { normalizeRoutingProfileSelections } = require("./routingProfileSelectionV2.service");
const { normalizeVenueControlSelections } = require("./venueRoutingControlSelectionV2.service");

function normalizeMovementPace(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 0.5;
}

function normalizeVenueRequirements(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry, index) => ({
    venueId: entry?.venueId,
    requirements: normalizeRoutingRequirements(entry?.requirements, { field: `navigation.venueRequirements[${index}].requirements` }),
  }));
}

async function resolveNavigationPreparation({ sourceAnchors = [], sourceLegHints = new Map(), navigation = {} } = {}) {
  const normalizedNavigation = {
    movementPacePreference: normalizeMovementPace(navigation.movementPacePreference),
    routingProfileSelections: normalizeRoutingProfileSelections(navigation.routingProfileSelections || [], { field: "navigation.routingProfileSelections" }),
    requirements: normalizeRoutingRequirements(navigation.requirements, { field: "navigation.requirements" }),
    venueControlSelections: normalizeVenueControlSelections(navigation.venueControlSelections || [], { field: "navigation.venueControlSelections" }),
    venueRequirements: normalizeVenueRequirements(navigation.venueRequirements || []),
  };
  return materializeSessionPhysicalPlan({
    sourceAnchors,
    sourceLegHints,
    navigation: normalizedNavigation,
  });
}

module.exports = {
  resolveNavigationPreparation,
};
