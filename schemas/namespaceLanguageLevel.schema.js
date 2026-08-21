const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const { Schema } = mongoose;

const NamespaceLanguageLevelSchema = new Schema({
  definitionId: { type: String, required: true, trim: true },
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
}, { _id: false });

module.exports = NamespaceLanguageLevelSchema;
