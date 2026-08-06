const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Livello linguistico locale. La posizione nell'array config.languageLevels
 * e l'unica fonte dell'ordinamento dal linguaggio piu semplice al piu complesso.
 */
const LanguageLevelSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  { _id: true },
);

module.exports = LanguageLevelSchema;
