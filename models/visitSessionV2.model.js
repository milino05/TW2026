const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenuePinSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  venueReleaseId: { type: Schema.Types.ObjectId, ref: "VenueRelease", required: true },
  layoutRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", required: true },
}, { _id: false });

const PresentationSelectionSchema = new Schema({
  variantId: { type: Schema.Types.ObjectId, required: true },
  representationId: { type: Schema.Types.ObjectId, required: true },
  durationTypeDefinitionId: { type: String, required: true, trim: true },
  languageLevelDefinitionId: { type: String, required: true, trim: true },
  locale: { type: String, required: true, trim: true },
  estimatedContentSeconds: { type: Number, min: 0, required: true },
}, { _id: false });

const PresentationOverrideSchema = new Schema({
  contentEntryId: { type: Schema.Types.ObjectId, required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  representationId: { type: Schema.Types.ObjectId, required: true },
  durationTypeDefinitionId: { type: String, required: true, trim: true },
  languageLevelDefinitionId: { type: String, required: true, trim: true },
  locale: { type: String, required: true, trim: true },
  estimatedContentSeconds: { type: Number, min: 0, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const SemanticPresentationSchema = new Schema({
  sourceActionId: { type: String, required: true, trim: true },
  sourceType: { type: String, enum: ["editorial_release", "direct_item"], default: "editorial_release" },
  sourceEditorialReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  namespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
  label: { type: String, required: true, trim: true },
  relationLabel: { type: String, trim: true, default: null },
  presentation: { type: PresentationSelectionSchema, required: true },
  openedAt: { type: Date, default: Date.now },
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

const InteractionContextSchema = new Schema({
  contentEntryId: { type: Schema.Types.ObjectId, default: null },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", default: null },
  visitAnchorId: { type: Schema.Types.ObjectId, default: null },
  semanticSubjectId: { type: Schema.Types.ObjectId, ref: "Subject", default: null },
  semanticItemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", default: null },
}, { _id: false });

const InteractionResultSchema = new Schema({
  status: { type: String, enum: ["applied", "rejected", "recorded"], required: true },
  code: { type: String, trim: true, default: null },
}, { _id: false });

const InteractionEventSchema = new Schema({
  category: { type: String, enum: ["action", "telemetry", "feedback"], required: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actionId: { type: String, trim: true, default: null },
  actionType: { type: String, trim: true, default: null },
  actionFamily: { type: String, trim: true, default: null },
  interactionChannel: { type: String, enum: ["button", "controlled_voice", "natural_language", "system", null], default: null },
  context: { type: InteractionContextSchema, default: () => ({}) },
  result: { type: InteractionResultSchema, required: true },
  metadata: { type: Schema.Types.Mixed, default: null },
  at: { type: Date, default: Date.now },
}, { _id: true });

const PauseIntervalSchema = new Schema({
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
}, { _id: false });

const RoutingProfileSelectionSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  routingProfileDefinitionId: { type: String, trim: true, required: true },
}, { _id: false });

const LogisticsStepSchema = new Schema({
  kind: { type: String, enum: ["connection", "transfer", "approach"], required: true },
  instruction: { type: String, required: true, trim: true },
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", default: null },
  connectionId: { type: Schema.Types.ObjectId, default: null },
  distanceMeters: { type: Number, min: 0, default: null },
  estimatedSeconds: { type: Number, min: 0, default: null },
  resolutionSource: { type: String, trim: true, default: null },
}, { _id: false });

const LogisticsProgressSchema = new Schema({
  fromEntryIndex: { type: Number, min: 0, required: true },
  targetEntryIndex: { type: Number, min: 0, required: true },
  fromVisitAnchorId: { type: Schema.Types.ObjectId, default: null },
  toVisitAnchorId: { type: Schema.Types.ObjectId, required: true },
  stepIndex: { type: Number, min: 0, default: 0 },
  steps: { type: [LogisticsStepSchema], default: [] },
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
  logisticsProgress: { type: LogisticsProgressSchema, default: null },
  runtimeVersion: { type: Number, min: 1, default: 1, required: true },
  navigationSnapshot: {
    movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
    routingProfileSelections: { type: [RoutingProfileSelectionSchema], default: [] },
    requirements: { type: [Schema.Types.Mixed], default: [] },
  },
  sessionMovementSpeedMps: { type: Number, min: 0.1, required: true },
  adaptivePolicyVersion: { type: Number, min: 1, required: true },
  presentationOverrides: { type: [PresentationOverrideSchema], default: [] },
  semanticPresentation: { type: SemanticPresentationSchema, default: null },
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
  const profileVenueIds = new Set();
  for (const selection of this.navigationSnapshot?.routingProfileSelections || []) {
    const venueId = String(selection.venueId || "");
    if (profileVenueIds.has(venueId)) { this.invalidate("navigationSnapshot.routingProfileSelections", "È ammesso un solo profilo di percorso per Venue"); break; }
    profileVenueIds.add(venueId);
  }
  if (this.logisticsProgress) {
    const steps = this.logisticsProgress.steps || [];
    const stepIndex = Number(this.logisticsProgress.stepIndex) || 0;
    if (!steps.length) this.invalidate("logisticsProgress.steps", "La progressione logistica richiede almeno un'indicazione");
    if (stepIndex >= steps.length) this.invalidate("logisticsProgress.stepIndex", "Indice della progressione logistica fuori intervallo");
    if (this.logisticsProgress.targetEntryIndex <= this.logisticsProgress.fromEntryIndex) {
      this.invalidate("logisticsProgress.targetEntryIndex", "La progressione logistica deve avanzare verso una ContentEntry successiva");
    }
  }
  next();
});

VisitSessionV2Schema.index({ userId: 1, status: 1, updatedAt: -1 });
VisitSessionV2Schema.index({ visitId: 1, startedAt: -1 });
module.exports = mongoose.model("VisitSessionV2", VisitSessionV2Schema);
