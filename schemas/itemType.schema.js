const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const ItemTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    capabilities: {
      type: [{ type: String, enum: ["visit_stop", "spatial_placement", "semantic_context"] }],
      default: ["semantic_context"],
    },
    semanticRefs: { type: [SemanticRefSchema], default: [] },
  },
  { _id: false },
);

module.exports = ItemTypeSchema;
