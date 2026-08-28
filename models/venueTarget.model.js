const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Schema } = mongoose;

function generatePublicCode() {
  return `at_${crypto.randomBytes(10).toString("hex")}`;
}

const VenueTargetSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, immutable: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true, index: true },
  publicCode: { type: String, required: true, immutable: true, unique: true, index: true, default: generatePublicCode },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

VenueTargetSchema.index({ venueId: 1, lifecycleStatus: 1, label: 1 });
VenueTargetSchema.index({ venueId: 1, subjectId: 1 });

module.exports = mongoose.model("VenueTarget", VenueTargetSchema);
