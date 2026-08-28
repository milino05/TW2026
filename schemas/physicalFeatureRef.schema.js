const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const PhysicalFeatureRefSchema = new Schema({
  kind: { type: String, enum: ["local", "semantic"], required: true },
  physicalVocabularyId: { type: Schema.Types.ObjectId, ref: "PhysicalVocabulary", default: null },
  definitionId: { type: String, trim: true, default: null },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
}, { _id: false });

PhysicalFeatureRefSchema.pre("validate", function validateReference(next) {
  if (this.kind === "local") {
    if (!this.physicalVocabularyId) this.invalidate("physicalVocabularyId", "Un riferimento locale richiede physicalVocabularyId");
    if (!this.definitionId) this.invalidate("definitionId", "Un riferimento locale richiede definitionId");
    if (this.semanticRefs?.length) this.invalidate("semanticRefs", "Un riferimento locale non contiene semanticRefs");
  }
  if (this.kind === "semantic") {
    if (this.physicalVocabularyId) this.invalidate("physicalVocabularyId", "Un riferimento semantico non pinna un PhysicalVocabulary");
    if (this.definitionId) this.invalidate("definitionId", "Un riferimento semantico non contiene definitionId locale");
    if (!this.semanticRefs?.length) this.invalidate("semanticRefs", "Un riferimento semantico richiede almeno una semanticRef");
  }
  next();
});

module.exports = PhysicalFeatureRefSchema;
