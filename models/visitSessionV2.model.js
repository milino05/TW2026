const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenuePinSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
}, { _id: false });

const PresentationOverrideSchema = new Schema({
  contentEntryId: { type: Schema.Types.ObjectId, required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  representationId: { type: Schema.Types.ObjectId, required: true },
  durationTypeDefinitionId: { type: String, required: true, trim: true },
  languageLevelDefinitionId: { type: String, required: true, trim: true },
  locale: { type: String, required: true, trim: true },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const TransitionObservationSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
  connectionId: { type: Schema.Types.ObjectId, required: true },
  distanceMeters: { type: Number, min: 0, required: true },
  predictedSeconds: { type: Number, min: 0, required: true },
  observedSeconds: { type: Number, min: 0, required: true },
  observedMovementSpeedMps: { type: Number, min: 0.1, default: null },
  reliability: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const ContentExperienceSchema = new Schema({
  contentEntryId: { type: Schema.Types.ObjectId, required: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  representationId: { type: Schema.Types.ObjectId, required: true },
  contentSeconds: { type: Number, min: 0, required: true },
  experiencedSeconds: { type: Number, min: 0, required: true },
  completionRatio: { type: Number, min: 0, max: 1, default: 1 },
  reliability: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const VenueTargetObservationSchema = new Schema({
  visitAnchorId: { type: Schema.Types.ObjectId, required: true },
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  observedSeconds: { type: Number, min: 0, required: true },
  reliability: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const InteractionEventSchema = new Schema({
  type: { type: String, enum: [
    "presentation_depth_increased", "presentation_depth_decreased",
    "presentation_language_increased", "presentation_language_decreased",
    "content_entry_completed", "content_entry_skipped", "knowledge_feedback",
  ], required: true },
  contentEntryId: { type: Schema.Types.ObjectId, default: null },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", default: null },
  variantId: { type: Schema.Types.ObjectId, default: null },
  representationId: { type: Schema.Types.ObjectId, default: null },
  metadata: { type: Schema.Types.Mixed, default: null },
  at: { type: Date, default: Date.now },
}, { _id: true });

const PauseIntervalSchema = new Schema({
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
}, { _id: false });

const VisitSessionV2Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sourceType: { type: String, enum: ["visit", "generated_plan"], required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: "VisitV2", default: null, index: true },
  visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null },
  generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlanV2", default: null, index: true },
  currentPlanRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevisionV2", default: null, index: true },
  venuePins: { type: [VenuePinSchema], default: [] },
  status: { type: String, enum: ["active", "paused", "route_completed", "completed", "abandoned"], default: "active", index: true },
  currentEntryIndex: { type: Number, min: 0, default: 0 },
  navigationSnapshot: {
    movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
    requirements: { type: [Schema.Types.Mixed], default: [] },
  },
  sessionMovementSpeedMps: { type: Number, min: 0.1, required: true },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  presentationOverrides: { type: [PresentationOverrideSchema], default: [] },
  transitionObservations: { type: [TransitionObservationSchema], default: [] },
  contentEntryExperiences: { type: [ContentExperienceSchema], default: [] },
  venueTargetObservations: { type: [VenueTargetObservationSchema], default: [] },
  interactionEvents: { type: [InteractionEventSchema], default: [] },
  pauseIntervals: { type: [PauseIntervalSchema], default: [] },
  startedAt: { type: Date, default: Date.now },
  routeCompletedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true, collection: "visit_sessions_v2" });

VisitSessionV2Schema.pre("validate", function validateSource(next) {
  if (this.sourceType === "visit" && (!this.visitId || !this.visitRevisionId)) this.invalidate("visitId", "visitId e visitRevisionId sono obbligatori");
  if (this.sourceType === "generated_plan" && !this.generatedVisitPlanId) this.invalidate("generatedVisitPlanId", "generatedVisitPlanId e obbligatorio");
  const venueIds = new Set();
  for (const pin of this.venuePins || []) {
    const key = String(pin.venueId || "");
    if (venueIds.has(key)) { this.invalidate("venuePins", "Una Venue puo essere pinzata una sola volta per Session"); break; }
    venueIds.add(key);
  }
  next();
});

VisitSessionV2Schema.index({ userId: 1, status: 1, updatedAt: -1 });
VisitSessionV2Schema.index({ visitId: 1, startedAt: -1 });
module.exports = mongoose.model("VisitSessionV2", VisitSessionV2Schema);
