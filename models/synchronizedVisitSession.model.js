const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenuePinSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
}, { _id: false });

const RoutingProfileSelectionSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  routingProfileDefinitionId: { type: String, trim: true, required: true },
}, { _id: false });

const SynchronizedVisitSessionSchema = new Schema({
  visitId: { type: Schema.Types.ObjectId, ref: "VisitV2", required: true, index: true, immutable: true },
  visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", required: true, index: true, immutable: true },
  hostUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
  joinAlias: { type: String, required: true, trim: true, maxlength: 80 },
  // Valorizzata soltanto durante lobby/active/quiz. L'indice univoco rende
  // l'alias riutilizzabile dopo la chiusura senza perdere quello mostrato nello storico.
  joinLookupKey: { type: String, trim: true, lowercase: true, default: null },
  status: { type: String, enum: ["lobby", "active", "quiz", "completed", "cancelled"], default: "lobby", index: true },
  currentEntryIndex: { type: Number, min: 0, default: 0, required: true },
  runtimeVersion: { type: Number, min: 1, default: 1, required: true },
  playback: {
    state: { type: String, enum: ["idle", "playing", "paused"], default: "idle", required: true },
    contentEntryId: { type: Schema.Types.ObjectId, default: null },
    commandVersion: { type: Number, min: 0, default: 0, required: true },
    changedAt: { type: Date, default: null },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  currentPlanRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevisionV2", default: null, index: true },
  venuePins: { type: [VenuePinSchema], default: [] },
  navigationSnapshot: {
    movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
    routingProfileSelections: { type: [RoutingProfileSelectionSchema], default: [] },
    requirements: { type: [Schema.Types.Mixed], default: [] },
  },
  sessionMovementSpeedMps: { type: Number, min: 0.1, required: true },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  startedAt: { type: Date, default: null },
  quizStartedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true, collection: "synchronized_visit_sessions" });

SynchronizedVisitSessionSchema.pre("validate", function validateRuntime(next) {
  const joinable = ["lobby", "active", "quiz"].includes(this.status);
  if (joinable && this.joinLookupKey == null && !this.isNew) {
    this.invalidate("joinLookupKey", "Una sessione raggiungibile richiede la chiave alias");
  }
  if (!joinable && this.joinLookupKey != null) {
    this.invalidate("joinLookupKey", "Una sessione conclusa non deve restare raggiungibile tramite alias");
  }
  const venueIds = new Set();
  for (const pin of this.venuePins || []) {
    const key = String(pin.venueId || "");
    if (venueIds.has(key)) {
      this.invalidate("venuePins", "Una Venue può essere pinzata una sola volta");
      break;
    }
    venueIds.add(key);
  }
  next();
});

SynchronizedVisitSessionSchema.index(
  { joinLookupKey: 1 },
  { unique: true, partialFilterExpression: { joinLookupKey: { $type: "string" } } },
);
SynchronizedVisitSessionSchema.index({ hostUserId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("SynchronizedVisitSession", SynchronizedVisitSessionSchema);
