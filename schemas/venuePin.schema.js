const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenuePinSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
  physicalVocabularyRevisionId: { type: Schema.Types.ObjectId, ref: "PhysicalVocabularyRevision", required: true },
}, { _id: false });

module.exports = VenuePinSchema;
