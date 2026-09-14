const mongoose = require("mongoose");
const RoutingRequirementSchema = require("./routingRequirement.schema");
const { Schema } = mongoose;

const VenueRoutingRequirementsSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  requirements: { type: [RoutingRequirementSchema], default: [] },
}, { _id: false });

module.exports = VenueRoutingRequirementsSchema;
