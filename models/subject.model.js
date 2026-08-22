const mongoose = require("mongoose");
const SemanticRefSchema = require("../schemas/semanticRef.schema");
const { Schema } = mongoose;

const SubjectSchema = new Schema(
  {
    preferredLabel: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: "" },
    externalRefs: { type: [SemanticRefSchema], default: [] },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
  },
  { timestamps: true },
);

SubjectSchema.index({ preferredLabel: "text", description: "text" });
SubjectSchema.index({ "externalRefs.scheme": 1, "externalRefs.id": 1 });

module.exports = mongoose.model("Subject", SubjectSchema);
