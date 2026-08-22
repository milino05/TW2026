const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenuePinSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
}, { _id: false });

const ExecutionSourceSchema = new Schema({
  sourceType: { type: String, enum: ["visit", "generated_plan"], required: true },
  visitId: { type: Schema.Types.ObjectId, ref: "VisitV2", default: null },
  visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null },
  generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlanV2", default: null },
  versionPolicy: { type: String, enum: ["follow_current", "pinned", "fixed_generated_plan"], required: true },
}, { _id: false });

const PresentationPreferenceSchema = new Schema({
  depthPreference: { type: Number, min: 0, max: 1, default: null },
  languageComplexityPreference: { type: Number, min: 0, max: 1, default: null },
  locale: { type: String, trim: true, default: null },
}, { _id: false });

const NavigationSnapshotSchema = new Schema({
  movementPacePreference: { type: Number, min: 0, max: 1, required: true },
  requirements: { type: [Schema.Types.Mixed], default: [] },
}, { _id: false });

const ExecutionPreparationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
  source: { type: ExecutionSourceSchema, required: true, immutable: true },
  version: { type: Number, min: 1, default: 1, required: true },
  status: { type: String, enum: ["active", "starting", "consumed"], default: "active", index: true },
  preparationDraft: { type: Schema.Types.Mixed, default: {} },
  effectivePresentationPreference: { type: PresentationPreferenceSchema, default: null },
  navigationSnapshot: { type: NavigationSnapshotSchema, required: true },
  venuePins: { type: [VenuePinSchema], default: [] },
  sessionMovementSpeedMps: { type: Number, min: 0.1, required: true },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  preparedPlanCandidate: { type: Schema.Types.Mixed, required: true },
  readiness: { type: Schema.Types.Mixed, required: true },
  logisticsPreview: { type: Schema.Types.Mixed, required: true },
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSessionV2", default: null, index: true },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true, collection: "execution_preparations_v2" });

ExecutionPreparationSchema.pre("validate", function validateSource(next) {
  if (this.source?.sourceType === "visit" && (!this.source.visitId || !this.source.visitRevisionId)) {
    this.invalidate("source", "Una preparation Visit richiede visitId e visitRevisionId");
  }
  if (this.source?.sourceType === "generated_plan" && !this.source.generatedVisitPlanId) {
    this.invalidate("source", "Una preparation GeneratedPlan richiede generatedVisitPlanId");
  }
  next();
});

ExecutionPreparationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ExecutionPreparationSchema.index({ userId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("ExecutionPreparation", ExecutionPreparationSchema);
