const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Livello di complessita linguistica disponibile nel museo.
 * `level` fornisce un ordinamento esplicito e stabile per i comandi
 * "piu semplice" e "troppo semplice".
 */
const LanguageLevelSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    label: {
      type: String,
      required: true,
      trim: true,
    },

    level: {
      type: Number,
      required: true,
      min: 1,
    },

    description: {
      type: String,
      trim: true,
    },
  },
  {
    _id: true,
  },
);

module.exports = LanguageLevelSchema;
