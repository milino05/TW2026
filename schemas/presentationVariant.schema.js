const mongoose = require("mongoose");
const RepresentationSchema = require("./representation.schema");
const SemanticFeatureRefSchema = require("./semanticFeatureRef.schema");
const { Schema } = mongoose;

const SemanticFocusSchema = new Schema({
  kind: { type: String, enum: ["item", "relation_type", "item_type", "canonical"], required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
  key: { type: String, trim: true, lowercase: true, default: null },
  scheme: { type: String, trim: true, lowercase: true, default: null },
  refId: { type: String, trim: true, default: null },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const PresentationAspectUseSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const AudienceSuitabilitySchema = new Schema({
  minAgeYears: { type: Number, min: 0, max: 130, default: null },
  maxAgeYears: { type: Number, min: 0, max: 130, default: null },
  minMaturity: { type: Number, min: 0, max: 1, default: null },
  maxMaturity: { type: Number, min: 0, max: 1, default: null },
}, { _id: false });

const KnowledgeRequirementSchema = new Schema({
  feature: { type: SemanticFeatureRefSchema, required: true },
  minLevel: { type: Number, min: 0, max: 1, default: 0 },
  maxLevel: { type: Number, min: 0, max: 1, default: 1 },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const PresentationVariantSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  semanticFocus: { type: [SemanticFocusSchema], default: [] },
  presentationAspects: { type: [PresentationAspectUseSchema], default: [] },
  audienceSuitability: { type: AudienceSuitabilitySchema, default: null },
  knowledgeRequirements: { type: [KnowledgeRequirementSchema], default: [] },
  representations: { type: [RepresentationSchema], default: [] },
}, { _id: true });

module.exports = PresentationVariantSchema;
