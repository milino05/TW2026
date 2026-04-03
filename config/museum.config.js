const mongoose = require("mongoose");
const { Schema } = mongoose;

const RelationType = require("../models/relationType.model");

const configSchema = new Schema({
  museoId: String,
  languageLevels: [String], // es: ["facile", "medio", "avanzato"]
  durationTypes: [String], // es: ["breve", "medio", "lungo"]
  itemTypes: [String], //es. ["opera", "pittore", "stile"]
  relationTypes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RelationType",
    },
  ], //es: ["created_by", "has_style", "located_in"]
});
