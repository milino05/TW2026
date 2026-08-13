const mongoose = require("mongoose");
const { Schema } = mongoose;

const SessionContentEntrySchema = new Schema({
  sourceContentEntryId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", required: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true },
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
  spatialMode: { type: String, enum: ["target", "context"], required: true },
  deliveryAnchorId: { type: Schema.Types.ObjectId, default: null },
  variantKey: { type: String, trim: true, lowercase: true, required: true },
  representationId: { type: Schema.Types.ObjectId, default: null },
  durationKey: { type: String, trim: true, lowercase: true, required: true },
  languageLevelKey: { type: String, trim: true, lowercase: true, required: true },
  estimatedContentSeconds: { type: Number, min: 0, required: true },
  utilityScore: { type: Number, default: 0 },
  scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
  reasons: { type: [{ source: String, message: String, confidence: Number }], default: [] },
}, { _id: true });

const PhysicalAnchorSchema = new Schema({
  kind: { type: String, enum: ["content_target", "place"], required: true },
  purpose: { type: String, enum: ["start", "content", "service", "end", "transfer"], required: true },
  contentEntryId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true },
  placeId: { type: Schema.Types.ObjectId, required: true },
  estimatedObservationSeconds: { type: Number, min: 0, default: 0 },
}, { _id: true });

const PhysicalLegSchema = new Schema({
  type: { type: String, enum: ["indoor", "inter_venue"], default: "indoor" },
  fromAnchorId: { type: Schema.Types.ObjectId, required: true },
  toAnchorId: { type: Schema.Types.ObjectId, required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
  path: { type: [Schema.Types.ObjectId], default: [] },
  estimatedSeconds: { type: Number, min: 0, required: true },
  preferencePenalty: { type: Number, min: 0, default: 0 },
  instruction: { type: String, trim: true, default: null },
  communityNote: { type: String, trim: true, default: null },
}, { _id: true });

const TimingSchema = new Schema({
  contentSeconds: { type: Number, min: 0, default: 0 },
  observationSeconds: { type: Number, min: 0, default: 0 },
  logisticsSeconds: { type: Number, min: 0, default: 0 },
  totalSeconds: { type: Number, min: 0, default: 0 },
  reservedSeconds: { type: Number, min: 0, default: 0 },
}, { _id: false });

const SessionPlanRevisionSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSession", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevision", default: null },
  status: { type: String, enum: ["active", "superseded"], default: "active", index: true },
  origin: {
    sourceType: { type: String, enum: ["visit", "generated_plan"], required: true },
    visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", default: null },
    generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlan", default: null },
  },
  createdReason: { type: String, enum: ["initial", "ahead_of_schedule", "behind_schedule", "manual_request", "refocus_future", "extend_visit", "parameter_change", "route_only"], default: "initial" },
  fidelity: { type: String, enum: ["preserve", "adapt", "regenerate"], default: "preserve" },
  executedThroughEntryIndex: { type: Number, min: -1, default: -1 },
  requestSnapshot: { type: Schema.Types.Mixed, default: {} },
  contextSnapshot: { type: Schema.Types.Mixed, default: {} },
  sourceVocabularyRevisionIds: { type: [{ type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision" }], default: [] },
  sourceLayoutRevisionIds: { type: [{ type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision" }], default: [] },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  contentEntries: { type: [SessionContentEntrySchema], default: [] },
  physicalRoute: {
    anchors: { type: [PhysicalAnchorSchema], default: [] },
    legs: { type: [PhysicalLegSchema], default: [] },
  },
  estimatedTiming: { type: TimingSchema, default: () => ({}) },
  utilityScore: { type: Number, default: 0 },
  explanation: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

SessionPlanRevisionSchema.index({ sessionId: 1, version: 1 }, { unique: true });
SessionPlanRevisionSchema.index({ sessionId: 1, status: 1 });
module.exports = mongoose.model("SessionPlanRevision", SessionPlanRevisionSchema);
