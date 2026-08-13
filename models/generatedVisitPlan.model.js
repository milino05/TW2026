const mongoose = require("mongoose");
const { Schema } = mongoose;

const GeneratedStopSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", required: true },
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

const GeneratedTransitionSchema = new Schema({
  fromStopIndex: { type: Number, min: -1, required: true },
  toStopIndex: { type: Number, min: 0, required: true },
  fromPlaceId: { type: Schema.Types.ObjectId, default: null },
  toPlaceId: { type: Schema.Types.ObjectId, default: null },
  path: { type: [Schema.Types.ObjectId], default: [] },
  estimatedSeconds: { type: Number, min: 0, required: true },
  preferencePenalty: { type: Number, min: 0, default: 0 },
}, { _id: true });

const GeneratedVisitPlanSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
  status: { type: String, enum: ["proposed", "accepted", "superseded"], default: "proposed", index: true },
  requestSnapshot: { type: Schema.Types.Mixed, required: true },
  contextSnapshot: { type: Schema.Types.Mixed, required: true },
  sourceVocabularyRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision", default: null },
  sourceLayoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  stops: { type: [GeneratedStopSchema], default: [] },
  transitions: { type: [GeneratedTransitionSchema], default: [] },
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
}, { timestamps: true });

GeneratedVisitPlanSchema.index({ userId: 1, museumId: 1, createdAt: -1 });
module.exports = mongoose.model("GeneratedVisitPlan", GeneratedVisitPlanSchema);
