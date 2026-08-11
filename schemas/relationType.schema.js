const mongoose = require("mongoose");
const { Schema } = mongoose;

const RelationTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    domain: [{ type: String, trim: true }],
    range: [{ type: String, trim: true }],

    /**
     * Le relazioni Item descrivono il grafo contenutistico. La logistica
     * vive esclusivamente nel MuseumLayout e non puo essere rappresentata
     * come relazione tra Item.
     */
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
  },
  { timestamps: true },
);

module.exports = RelationTypeSchema;
