const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const NamespaceRelationTypeDefinitionSchema = new Schema({
  definitionId: { type: String, required: true, trim: true },
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  domainDefinitionIds: { type: [{ type: String, trim: true }], default: [] },
  rangeDefinitionIds: { type: [{ type: String, trim: true }], default: [] },
  category: { type: String, enum: ["semantic", "contextual", "editorial"], default: "semantic" },
  strength: { type: String, enum: ["strong", "medium", "weak"], default: "medium" },
  userIntents: { type: [{ type: String, trim: true }], default: [] },
  directionality: { type: String, enum: ["directed", "symmetric"], default: "directed" },
  reverse: {
    label: { type: String, trim: true },
    description: { type: String, trim: true },
    userIntents: { type: [{ type: String, trim: true }], default: [] },
  },
  validationRules: {
    allowMultiple: { type: Boolean, default: true },
    targetRequired: { type: Boolean, default: true },
  },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
}, { _id: false });

module.exports = NamespaceRelationTypeDefinitionSchema;
