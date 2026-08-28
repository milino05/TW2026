const { materializeSessionPhysicalPlan } = require("./physicalExecutionV2.service");
const { normalizeRoutingRequirements } = require("./routingPreferenceV2.service");
const { normalizeRoutingProfileSelections } = require("./routingProfileSelectionV2.service");

function normalizeMovementPace(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 0.5;
}

async function resolveNavigationPreparation({ sourceAnchors = [], sourceLegHints = new Map(), navigation = {} } = {}) {
  const normalizedNavigation = {
    movementPacePreference: normalizeMovementPace(navigation.movementPacePreference),
    routingProfileSelections: normalizeRoutingProfileSelections(navigation.routingProfileSelections || [], { field: "navigation.routingProfileSelections" }),
    requirements: normalizeRoutingRequirements(navigation.requirements, { field: "navigation.requirements" }),
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