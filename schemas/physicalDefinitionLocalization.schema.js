const mongoose = require("mongoose");
const { Schema } = mongoose;

const PhysicalDefinitionLocalizationSchema = new Schema({
  locale: { type: String, required: true, trim: true },
  label: { type: String, trim: true, default: null },
  description: { type: String, trim: true, default: null },
  aliases: { type: [{ type: String, trim: true }], default: [] },
}, { _id: false });

module.exports = PhysicalDefinitionLocalizationSchema;
