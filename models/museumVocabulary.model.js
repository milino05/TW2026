const mongoose = require("mongoose");
const { Schema } = mongoose;

const MuseumVocabularySchema = new Schema({
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, unique: true, index: true },
  publishedRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision", default: null, index: true },
  workingRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision", default: null, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("MuseumVocabulary", MuseumVocabularySchema);
