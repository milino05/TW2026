const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const ItemTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    capabilities: {
      type: [{ type: String, enum: ["navigation_target", "spatial_placement", "semantic_context"] }],
      default: ["semantic_context"],
    },
    semanticRefs: { type: [SemanticRefSchema], default: [] },
  },
  { _id: false },
);

ItemTypeSchema.pre("validate", function validateCapabilities(next) {
  const capabilities = new Set(this.capabilities || []);
  if (capabilities.has("navigation_target") && !capabilities.has("spatial_placement")) {
    this.invalidate("capabilities", "navigation_target richiede spatial_placement");
  }
  next();
});

module.exports = ItemTypeSchema;
