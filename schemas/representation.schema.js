const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Rappresentazione alternativa dello stesso item, identificata dalla coppia
 * durationKey/languageLevelKey.
 */
const RepresentationSchema = new Schema(
  {
    /** Chiave di un durationType configurato nel museo. */
    durationKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    /** Chiave di un languageLevel configurato nel museo. */
    languageLevelKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    /** Fallback dell'item quando non esiste una policy di visita applicabile. */
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

module.exports = RepresentationSchema;
