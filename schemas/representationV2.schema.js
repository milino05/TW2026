const mongoose = require("mongoose");
const { Schema } = mongoose;

const RepresentationV2Schema = new Schema({
  durationTypeDefinitionId: { type: String, required: true, trim: true },
  languageLevelDefinitionId: { type: String, required: true, trim: true },
  locale: { type: String, required: true, trim: true },
  text: { type: String, required: true, trim: true },
}, { _id: true });

module.exports = RepresentationV2Schema;
