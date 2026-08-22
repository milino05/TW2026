const mongoose = require("mongoose");
const { Schema } = mongoose;

const RecognitionMediaSchema = new Schema({
  url: { type: String, required: true, trim: true },
  altText: { type: String, trim: true, default: null },
}, { _id: true });

const VenueTargetReleaseBindingSchema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  availability: { type: String, enum: ["active", "unavailable"], default: "active" },
  recognitionMedia: { type: [RecognitionMediaSchema], default: [] },
}, { _id: false });

module.exports = VenueTargetReleaseBindingSchema;
