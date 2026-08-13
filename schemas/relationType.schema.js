const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const RelationTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    domain: [{ type: String, trim: true, lowercase: true }],
    range: [{ type: String, trim: true, lowercase: true }],
    category: {
      type: String,
      required: true,
      enum: ["semantic", "contextual", "editorial"],
    },
    strength: { type: String, enum: ["strong", "medium", "weak"], default: "medium" },
    userIntents: [{ type: String, trim: true }],
    directionality: { type: String, enum: ["directed", "symmetric"], default: "directed" },
    reverse: {
      label: { type: String, trim: true },
      description: { type: String, trim: true },
      userIntents: [{ type: String, trim: true }],
    },
    validationRules: {
      allowMultiple: { type: Boolean, default: true },
      targetRequired: { type: Boolean, default: true },
    },
    /** Mapping opzionali verso vocabolari/knowledge base esterni. */
    semanticRefs: { type: [SemanticRefSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = RelationTypeSchema;
