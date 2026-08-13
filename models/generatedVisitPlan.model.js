const mongoose = require("mongoose");
const { Schema } = mongoose;

const GeneratedContentEntrySchema = new Schema({
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

const GeneratedVisitPlanSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
  status: { type: String, enum: ["proposed", "accepted", "superseded"], default: "proposed", index: true },
  requestSnapshot: { type: Schema.Types.Mixed, required: true },
  contextSnapshot: { type: Schema.Types.Mixed, required: true },
  sourceVocabularyRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumVocabularyRevision", default: null },
  sourceLayoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  contentEntries: { type: [GeneratedContentEntrySchema], default: [] },
  physicalRoute: {
    anchors: { type: [PhysicalAnchorSchema], default: [] },
    legs: { type: [PhysicalLegSchema], default: [] },
  },
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
