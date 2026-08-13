const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Versione testuale di una PresentationVariant per una coppia duration/language.
 * `isDefault` resta solo per compatibilita con revisioni legacy; il nuovo modello
 * usa ItemRevision.defaultPresentation.
 */
const RepresentationSchema = new Schema(
  {
    durationKey: { type: String, required: true, trim: true, lowercase: true },
    languageLevelKey: { type: String, required: true, trim: true, lowercase: true },
    text: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

module.exports = RepresentationSchema;
