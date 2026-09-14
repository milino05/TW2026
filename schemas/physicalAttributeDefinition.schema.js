const mongoose = require("mongoose");
const physicalDefinitionBase = require("./physicalDefinitionBase");
const { Schema } = mongoose;

const PhysicalAttributeOptionSchema = new Schema({
  value: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
}, { _id: false });

const VisitorControlSchema = new Schema({
  enabled: { type: Boolean, default: false },
  label: { type: String, trim: true, default: null },
  description: { type: String, trim: true, default: null },
  operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
  valueMode: { type: String, enum: ["fixed", "user"], default: "fixed" },
  value: { type: Schema.Types.Mixed, default: null },
  priority: { type: String, enum: ["required", "preferred", "avoid"], default: "preferred" },
}, { _id: false });

const PhysicalAttributeDefinitionSchema = new Schema(physicalDefinitionBase({
  dataType: { type: String, enum: ["boolean", "number", "string", "choice"], required: true },
  unit: { type: String, trim: true, default: null },
  options: { type: [PhysicalAttributeOptionSchema], default: [] },
  appliesTo: { type: String, enum: ["place", "connection", "both"], required: true },
  visitorControl: { type: VisitorControlSchema, default: () => ({ enabled: false }) },
}), { _id: false });

module.exports = PhysicalAttributeDefinitionSchema;
