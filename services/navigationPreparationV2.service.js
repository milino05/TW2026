const { materializeSessionPhysicalPlan } = require("./physicalExecutionV2.service");
const { normalizeCanonicalRoutingRequirements } = require("./routingPreferenceV2.service");

function normalizeMovementPace(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 0.5;
}

async function resolveNavigationPreparation({ sourceAnchors = [], sourceLegHints = new Map(), navigation = {} } = {}) {
  const normalizedNavigation = {
    movementPacePreference: normalizeMovementPace(navigation.movementPacePreference),
    requirements: normalizeCanonicalRoutingRequirements(navigation.requirements, { field: "navigation.requirements" }),
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
