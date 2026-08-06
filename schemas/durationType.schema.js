const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Tipo di durata appartenente al vocabolario locale di un museo.
 * L'ordine e dato esclusivamente dalla posizione nell'array config.durationTypes.
 */
const DurationTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    /** Durata editoriale indicativa della narrazione a velocita standard. */
    targetSeconds: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "targetSeconds deve essere un numero intero",
      },
    },
  },
  { _id: true },
);

module.exports = DurationTypeSchema;
