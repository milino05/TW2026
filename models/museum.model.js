const mongoose = require("mongoose");
const DurationTypeSchema = require("../schemas/durationType.schema");
const RelationTypeSchema = require("../schemas/relationType.schema");
const { Schema } = mongoose;

const MuseumSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },

    config: {
      languageLevels: [{ type: String, trim: true }],
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
