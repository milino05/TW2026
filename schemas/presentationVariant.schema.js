const mongoose = require("mongoose");
const RepresentationSchema = require("./representation.schema");
const { Schema } = mongoose;

const SemanticFocusSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["item", "relation_type", "item_type", "canonical"],
      required: true,
    },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
    key: { type: String, trim: true, lowercase: true, default: null },
    scheme: { type: String, trim: true, lowercase: true, default: null },
    refId: { type: String, trim: true, default: null },
    weight: { type: Number, min: 0, max: 1, default: 1 },
  },
  { _id: false },
);

const PresentationAspectUseSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    weight: { type: Number, min: 0, max: 1, default: 1 },
  },
  { _id: false },
);

const PresentationVariantSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    semanticFocus: { type: [SemanticFocusSchema], default: [] },
    presentationAspects: { type: [PresentationAspectUseSchema], default: [] },
    representations: { type: [RepresentationSchema], default: [] },
  },
  { _id: true },
);

module.exports = PresentationVariantSchema;
