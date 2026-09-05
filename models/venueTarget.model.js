const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenueTargetProvenanceSchema = new Schema({
  origin: { type: String, enum: ["human", "wikidata", "imported", "item_authoring", "inventory_proposal"], default: "human" },
  sourceId: { type: String, trim: true, default: null },
  metadata: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const VenueTargetSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, immutable: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true, index: true },
  // Kept only for imported records while the ExhibitSlot migration is running.
  // New public codes belong exclusively to ExhibitSlot.
  publicCode: { type: String, trim: true, immutable: true },
  displayLabelOverride: { type: String, trim: true, default: null },
  inventoryNote: { type: String, trim: true, default: null },
  provenance: { type: VenueTargetProvenanceSchema, default: () => ({ origin: "human" }) },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

VenueTargetSchema.index({ venueId: 1, lifecycleStatus: 1, displayLabelOverride: 1 });
VenueTargetSchema.index(
  { publicCode: 1 },
  { unique: true, partialFilterExpression: { publicCode: { $type: "string" } }, name: "publicCode_1" },
);
VenueTargetSchema.index(
  { venueId: 1, subjectId: 1 },
  { unique: true, partialFilterExpression: { lifecycleStatus: "active" }, name: "unique_active_venue_subject" },
);

module.exports = mongoose.model("VenueTarget", VenueTargetSchema);
