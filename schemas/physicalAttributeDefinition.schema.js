const mongoose = require("mongoose");
const physicalDefinitionBase = require("./physicalDefinitionBase");
const { Schema } = mongoose;

const PhysicalAttributeOptionSchema = new Schema({
  value: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
}, { _id: false });

const PhysicalAttributeDefinitionSchema = new Schema(physicalDefinitionBase({
  dataType: { type: String, enum: ["boolean", "number", "string", "choice"], required: true },
  unit: { type: String, trim: true, default: null },
  options: { type: [PhysicalAttributeOptionSchema], default: [] },
  appliesTo: { type: String, enum: ["place", "connection", "both"], required: true },
}), { _id: false });

module.exports = PhysicalAttributeDefinitionSchema;
