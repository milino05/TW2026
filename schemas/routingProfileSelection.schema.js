const mongoose = require("mongoose");
const { Schema } = mongoose;

const RoutingProfileSelectionSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  routingProfileDefinitionId: { type: String, trim: true, required: true },
}, { _id: false });

module.exports = RoutingProfileSelectionSchema;
