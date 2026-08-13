const mongoose = require("mongoose");
const { Schema } = mongoose;

const TransitionObservationSchema = new Schema({ connectionId: { type: Schema.Types.ObjectId, required: true }, layoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", required: true }, distanceMeters: { type: Number, min: 0, required: true }, predictedSeconds: { type: Number, min: 0, required: true }, observedSeconds: { type: Number, min: 0, required: true }, observedMovementSpeedMps: { type: Number, min: 0.1, default: null }, reliability: { type: Number, min: 0, max: 1, default: 1 } }, { _id: false });
const StopObservationSchema = new Schema({ itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true }, variantKey: { type: String, trim: true, lowercase: true, default: null }, contentSeconds: { type: Number, min: 0, required: true }, totalStopSeconds: { type: Number, min: 0, required: true }, postContentObservationSeconds: { type: Number, min: 0, required: true }, reliability: { type: Number, min: 0, max: 1, default: 1 } }, { _id: false });
const PauseIntervalSchema = new Schema({ startedAt: { type: Date, required: true }, endedAt: { type: Date, default: null } }, { _id: false });
const InteractionEventSchema = new Schema({
  type: { type: String, enum: ["presentation_depth_increased", "presentation_depth_decreased", "semantic_drilldown", "visit_refocus_requested", "visit_extension_requested", "stop_skipped", "stop_completed", "manual_add", "manual_remove"], required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
  variantKey: { type: String, trim: true, lowercase: true, default: null },
  at: { type: Date, default: Date.now },
  metadata: { type: Schema.Types.Mixed, default: null },
}, { _id: true });

const VisitSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sourceType: { type: String, enum: ["visit", "generated_plan"], required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: "Visit", default: null, index: true },
  visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", default: null },
  generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlan", default: null, index: true },
  currentPlanRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevision", default: null, index: true },
  status: { type: String, enum: ["active", "paused", "route_completed", "completed", "abandoned"], default: "active", index: true },
  currentStopIndex: { type: Number, min: 0, default: 0 },
  movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
  initialMovementBaselineMps: { type: Number, min: 0.1, default: null },
  initialPaceFactor: { type: Number, min: 0.1, default: 1 },
  sessionMovementSpeedMps: { type: Number, min: 0.1, default: null },
  initialObservationSeconds: { type: Number, min: 0, default: null },
  initialBaseEstimatedTotalSeconds: { type: Number, min: 0, default: null },
  initialEstimatedTotalSeconds: { type: Number, min: 0, default: null },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  transitionObservations: { type: [TransitionObservationSchema], default: [] },
  stopObservations: { type: [StopObservationSchema], default: [] },
  interactionEvents: { type: [InteractionEventSchema], default: [] },
  pauseIntervals: { type: [PauseIntervalSchema], default: [] },
  startedAt: { type: Date, default: Date.now },
  routeCompletedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

VisitSessionSchema.pre("validate", function validateSource(next) {
  if (this.sourceType === "visit" && (!this.visitId || !this.visitRevisionId)) this.invalidate("visitId", "visitId e visitRevisionId sono obbligatori per una sessione visit");
  if (this.sourceType === "generated_plan" && !this.generatedVisitPlanId) this.invalidate("generatedVisitPlanId", "generatedVisitPlanId e obbligatorio per una sessione generated_plan");
  next();
});

module.exports = mongoose.model("VisitSession", VisitSessionSchema);
