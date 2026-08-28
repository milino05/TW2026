const mongoose = require("mongoose");
const physicalDefinitionBase = require("./physicalDefinitionBase");
const { Schema } = mongoose;

const RoutingProfileRequirementSchema = new Schema({
  physicalAttributeDefinitionId: { type: String, required: true, trim: true },
  operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
  value: { type: Schema.Types.Mixed, required: true },
  priority: { type: String, enum: ["required", "preferred", "avoid"], default: "preferred" },
  weight: { type: Number, min: 0, default: 1 },
}, { _id: false });

const RoutingProfileDefinitionSchema = new Schema(physicalDefinitionBase({
  requirements: { type: [RoutingProfileRequirementSchema], default: [] },
}), { _id: false });

module.exports = RoutingProfileDefinitionSchema;
