const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenueSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true, default: "" },
  ownerOrganizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  primaryEditorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", default: null, index: true },
  workingReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", default: null, index: true },
  publishedReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", default: null, index: true },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

VenueSchema.index({ ownerOrganizationId: 1, lifecycleStatus: 1, name: 1 });

module.exports = mongoose.model("Venue", VenueSchema);
