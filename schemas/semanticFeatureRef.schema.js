const mongoose = require("mongoose");
const { Schema } = mongoose;

const SemanticFeatureRefSchema = new Schema({
  kind: { type: String, enum: ["item", "item_type", "relation_type", "canonical", "presentation_aspect", "selection_signal", "tag"], required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
  key: { type: String, trim: true, lowercase: true, default: null },
  scheme: { type: String, trim: true, lowercase: true, default: null },
  refId: { type: String, trim: true, default: null },
}, { _id: false });

module.exports = SemanticFeatureRefSchema;
