const { loadPinnedBundle } = require("./physicalExecutionV2.service");
const { compileVenueControlSelections } = require("./venueRoutingControlSelectionV2.service");

function id(value) { return String(value?._id || value || ""); }

async function materializeExecutionNavigationSnapshot({ navigation = {}, venuePins = [] } = {}) {
  let venueRequirements = Array.isArray(navigation.venueRequirements) ? navigation.venueRequirements : [];
  const selections = Array.isArray(navigation.venueControlSelections) ? navigation.venueControlSelections : [];
  if (selections.length) {
    const pseudoSession = { venuePins };
    const bundleByVenueId = new Map();
    for (const pin of venuePins || []) {
      const bundle = await loadPinnedBundle(pseudoSession, pin.venueId);
      bundleByVenueId.set(id(pin.venueId), bundle);
    }
    venueRequirements = compileVenueControlSelections({ selections, bundleByVenueId });
  }
  return {
    movementPacePreference: Number(navigation.movementPacePreference ?? 0.5),
    routingProfileSelections: navigation.routingProfileSelections || [],
    requirements: navigation.requirements || [],
    venueRequirements,
  };
}

module.exports = { materializeExecutionNavigationSnapshot };
