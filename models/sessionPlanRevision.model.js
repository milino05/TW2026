const mongoose = require("mongoose");
const { Schema } = mongoose;

const SessionPlanStopSchema = new Schema({
  sourceStopId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", required: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true },
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
  variantKey: { type: String, trim: true, lowercase: true, required: true },
  representationId: { type: Schema.Types.ObjectId, default: null },
  durationKey: { type: String, trim: true, lowercase: true, required: true },
  languageLevelKey: { type: String, trim: true, lowercase: true, required: true },
  estimatedContentSeconds: { type: Number, min: 0, required: true },
  estimatedObservationSeconds: { type: Number, min: 0, required: true },
  utilityScore: { type: Number, default: 0 },
  scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
  reasons: { type: [{ source: String, message: String, confidence: Number }], default: [] },
}, { _id: true });

const SessionPlanTransitionSchema = new Schema({
  type: { type: String, enum: ["indoor", "inter_venue"], default: "indoor" },
  fromStopIndex: { type: Number, min: -1, required: true },
  toStopIndex: { type: Number, min: 0, required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
  fromPlaceId: { type: Schema.Types.ObjectId, default: null },
  toPlaceId: { type: Schema.Types.ObjectId, default: null },
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
  createdReason: { type: String, enum: ["initial", "ahead_of_schedule", "behind_schedule", "manual_request", "refocus_future", "extend_visit", "parameter_change"], default: "initial" },
  fidelity: { type: String, enum: ["preserve", "adapt", "regenerate"], default: "preserve" },
  executedThroughStopIndex: { type: Number, min: -1, default: -1 },
  requestSnapshot: { type: Schema.Types.Mixed, default: {} },
  contextSnapshot: { type: Schema.Types.Mixed, default: {} },
  sourceVocabularyRevisionIds: { type: [{ type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision" }], default: [] },
  sourceLayoutRevisionIds: { type: [{ type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision" }], default: [] },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  stops: { type: [SessionPlanStopSchema], default: [] },
  transitions: { type: [SessionPlanTransitionSchema], default: [] },
  estimatedTiming: { type: TimingSchema, default: () => ({}) },
  utilityScore: { type: Number, default: 0 },
  explanation: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

SessionPlanRevisionSchema.index({ sessionId: 1, version: 1 }, { unique: true });
SessionPlanRevisionSchema.index({ sessionId: 1, status: 1 });
module.exports = mongoose.model("SessionPlanRevision", SessionPlanRevisionSchema);
