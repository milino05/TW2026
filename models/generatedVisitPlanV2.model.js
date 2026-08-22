const mongoose = require("mongoose");
const { Schema } = mongoose;

const ReasonSchema = new Schema({
  source: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  confidence: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const GeneratedContentEntryV2Schema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  sourceEditorialReleaseIds: [{ type: Schema.Types.ObjectId, ref: "EditorialRelease", required: true }],
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
  deliveryAnchorId: { type: Schema.Types.ObjectId, default: null },
  variantId: { type: Schema.Types.ObjectId, required: true },
  representationId: { type: Schema.Types.ObjectId, required: true },
  durationTypeDefinitionId: { type: String, required: true, trim: true },
  languageLevelDefinitionId: { type: String, required: true, trim: true },
  locale: { type: String, required: true, trim: true },
  estimatedContentSeconds: { type: Number, min: 0, required: true },
  utilityScore: { type: Number, default: 0 },
  scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
  reasons: { type: [ReasonSchema], default: [] },
}, { _id: true });

const GeneratedVisitAnchorV2Schema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  placeId: { type: Schema.Types.ObjectId, required: true },
  estimatedObservationSeconds: { type: Number, min: 0, default: 0 },
}, { _id: true });

const GeneratedPhysicalLegV2Schema = new Schema({
  type: { type: String, enum: ["indoor", "inter_venue"], required: true },
  fromAnchorId: { type: Schema.Types.ObjectId, required: true },
  toAnchorId: { type: Schema.Types.ObjectId, required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", default: null },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", default: null },
  path: { type: [Schema.Types.ObjectId], default: [] },
  estimatedSeconds: { type: Number, min: 0, required: true },
  preferencePenalty: { type: Number, min: 0, default: 0 },
  instruction: { type: String, trim: true, default: null },
}, { _id: true });

const GeneratedVisitPlanV2Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["proposed", "accepted", "superseded"], default: "proposed", index: true },
  requestSnapshot: { type: Schema.Types.Mixed, required: true },
  contextSnapshot: { type: Schema.Types.Mixed, required: true },
  sourceEditorialReleaseIds: [{ type: Schema.Types.ObjectId, ref: "EditorialRelease", required: true }],
  sourceVenueReleaseIds: [{ type: Schema.Types.ObjectId, ref: "VenueRelease", required: true }],
  sourceLayoutRevisionIds: [{ type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true }],
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  contentEntries: { type: [GeneratedContentEntryV2Schema], default: [] },
  visitAnchors: { type: [GeneratedVisitAnchorV2Schema], default: [] },
  physicalRoute: { legs: { type: [GeneratedPhysicalLegV2Schema], default: [] } },
  estimatedTiming: {
    contentSeconds: { type: Number, min: 0, default: 0 },
    observationSeconds: { type: Number, min: 0, default: 0 },
    logisticsSeconds: { type: Number, min: 0, default: 0 },
    totalSeconds: { type: Number, min: 0, default: 0 },
    reservedSeconds: { type: Number, min: 0, default: 0 },
  },
  utilityScore: { type: Number, default: 0 },
  explanation: { type: Schema.Types.Mixed, default: {} },
  acceptedAt: { type: Date, default: null },
}, { timestamps: true, collection: "generated_visit_plans_v2" });

GeneratedVisitPlanV2Schema.index({ userId: 1, createdAt: -1 });
GeneratedVisitPlanV2Schema.index({ sourceEditorialReleaseIds: 1, createdAt: -1 });
GeneratedVisitPlanV2Schema.index({ sourceVenueReleaseIds: 1, createdAt: -1 });

module.exports = mongoose.model("GeneratedVisitPlanV2", GeneratedVisitPlanV2Schema);
