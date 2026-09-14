const mongoose = require("mongoose");
const RoutingRequirementSchema = require("./routingRequirement.schema");
const RoutingProfileSelectionSchema = require("./routingProfileSelection.schema");
const VenueRoutingRequirementsSchema = require("./venueRoutingRequirements.schema");
const { Schema } = mongoose;

const NavigationSnapshotSchema = new Schema({
  movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
  routingProfileSelections: { type: [RoutingProfileSelectionSchema], default: [] },
  requirements: { type: [RoutingRequirementSchema], default: [] },
  venueRequirements: { type: [VenueRoutingRequirementsSchema], default: [] },
}, { _id: false });

NavigationSnapshotSchema.pre("validate", function validateVenueScope(next) {
  const profileVenueIds = new Set();
  for (const selection of this.routingProfileSelections || []) {
    const venueId = String(selection?.venueId || "");
    if (profileVenueIds.has(venueId)) {
      this.invalidate("routingProfileSelections", "È ammesso un solo profilo di percorso per Venue");
      break;
    }
    profileVenueIds.add(venueId);
  }

  const requirementVenueIds = new Set();
  for (const entry of this.venueRequirements || []) {
    const venueId = String(entry?.venueId || "");
    if (requirementVenueIds.has(venueId)) {
      this.invalidate("venueRequirements", "È ammesso un solo gruppo di requisiti locali per Venue");
      break;
    }
    requirementVenueIds.add(venueId);
  }
  next();
});

module.exports = NavigationSnapshotSchema;
