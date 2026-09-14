const mongoose = require("mongoose");
const PhysicalFeatureRefSchema = require("./physicalFeatureRef.schema");
const { Schema } = mongoose;

const RoutingRequirementSchema = new Schema({
  physicalFeatureRef: { type: PhysicalFeatureRefSchema, required: true },
  operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
  value: { type: Schema.Types.Mixed, required: true },
  priority: { type: String, enum: ["required", "preferred", "avoid"], default: "preferred" },
  weight: { type: Number, min: 0, default: 1 },
}, { _id: false });

module.exports = RoutingRequirementSchema;
