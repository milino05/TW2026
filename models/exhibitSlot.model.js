const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Schema } = mongoose;

function generatePublicCode() {
  return `as_${crypto.randomBytes(12).toString("hex")}`;
}

const ExhibitSlotSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, immutable: true, index: true },
  publicCode: { type: String, required: true, immutable: true, unique: true, index: true, default: generatePublicCode },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });

ExhibitSlotSchema.index({ venueId: 1, lifecycleStatus: 1, createdAt: 1 });

module.exports = mongoose.model("ExhibitSlot", ExhibitSlotSchema);
