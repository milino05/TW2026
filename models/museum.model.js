const mongoose = require("mongoose");
const DurationTypeSchema = require("../schemas/durationType.schema");
const LanguageLevelSchema = require("../schemas/languageLevel.schema");
const RelationTypeSchema = require("../schemas/relationType.schema");
const { Schema } = mongoose;

const MuseumSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },

    /** Creatore storico, immutabile. */
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    /** Incrementata a ogni modifica del vocabolario. */
    vocabularyRevision: { type: Number, default: 1, min: 1 },

    config: {
      languageLevels: { type: [LanguageLevelSchema], default: [] },
      durationTypes: { type: [DurationTypeSchema], default: [] },
      itemTypes: { type: [{ type: String, trim: true }], default: [] },
      relationTypes: { type: [RelationTypeSchema], default: [] },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Museum", MuseumSchema);
