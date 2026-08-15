const mongoose = require("mongoose");
const { Schema } = mongoose;

const RepresentationSchema = new Schema(
  {
    durationKey: { type: String, required: true, trim: true, lowercase: true },
    languageLevelKey: { type: String, required: true, trim: true, lowercase: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: true },
);

module.exports = RepresentationSchema;
