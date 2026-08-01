const mongoose = require("mongoose");
const DurationTypeSchema = require("../schemas/durationType.schema");
const LanguageLevelSchema = require("../schemas/languageLevel.schema");
const RelationTypeSchema = require("../schemas/relationType.schema");
const { Schema } = mongoose;

const MuseumSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    config: {
      languageLevels: [LanguageLevelSchema],
      durationTypes: [DurationTypeSchema],
      itemTypes: [{ type: String, trim: true }],
      relationTypes: [RelationTypeSchema],
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Museum", MuseumSchema);
