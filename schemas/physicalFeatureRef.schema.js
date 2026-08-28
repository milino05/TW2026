const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const PhysicalFeatureRefSchema = new Schema({
  kind: { type: String, enum: ["local", "semantic"], required: true },
  physicalVocabularyId: { type: Schema.Types.ObjectId, ref: "PhysicalVocabulary", default: null },
  definitionId: { type: String, trim: true, default: null },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
}, { _id: false });

PhysicalFeatureRefSchema.pre("validate", function validateShape(next) {
  if (this.kind === "local" && (!this.physicalVocabularyId || !this.definitionId || this.semanticRefs.length)) {
    return next(new Error("PhysicalFeatureRef local non valido"));
  }
  if (this.kind === "semantic" && (this.physicalVocabularyId || this.definitionId || !this.semanticRefs.length)) {
    return next(new Error("PhysicalFeatureRef semantic non valido"));
  }
  return next();
});

module.exports = PhysicalFeatureRefSchema;
