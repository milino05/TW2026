const mongoose = require("mongoose");
const { Schema } = mongoose;

const DecisionSchema = new Schema({
  decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  decidedAt: { type: Date, default: null },
  message: { type: String, trim: true, maxlength: 1000, default: null },
}, { _id: false });

const VenueInventoryProposalSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, immutable: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true, index: true },
  sourceItemId: { type: Schema.Types.ObjectId, ref: "ItemV2", default: null, immutable: true, index: true },
  proposedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  message: { type: String, trim: true, maxlength: 1000, default: null },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "withdrawn"],
    default: "pending",
    index: true,
  },
  decision: { type: DecisionSchema, default: () => ({}) },
  acceptedVenueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", default: null },
}, { timestamps: true });

VenueInventoryProposalSchema.index({ venueId: 1, status: 1, createdAt: -1 });
VenueInventoryProposalSchema.index({ venueId: 1, subjectId: 1, status: 1 });
VenueInventoryProposalSchema.index(
  { venueId: 1, subjectId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
    name: "unique_pending_venue_subject_proposal",
  },
);

module.exports = mongoose.model("VenueInventoryProposal", VenueInventoryProposalSchema);
