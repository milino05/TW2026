const mongoose = require("mongoose");
const { Schema } = mongoose;

const SessionContentEntrySchema = new Schema({
  sourceContentEntryId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  namespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true },
  sourceEditorialReleaseIds: [{ type: Schema.Types.ObjectId, ref: "EditorialRelease", required: true }],
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
  deliveryAnchorId: { type: Schema.Types.ObjectId, default: null },
  baselinePresentation: {
    variantId: { type: Schema.Types.ObjectId, required: true },
    representationId: { type: Schema.Types.ObjectId, required: true },
    durationTypeDefinitionId: { type: String, required: true, trim: true },
    languageLevelDefinitionId: { type: String, required: true, trim: true },
    locale: { type: String, required: true, trim: true },
    estimatedContentSeconds: { type: Number, min: 0, required: true },
  },
}, { _id: true });

const SessionSemanticGraphPinSchema = new Schema({
  sourceType: { type: String, enum: ["editorial_release", "direct_item"], required: true },
  sourceEditorialReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null },
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true },
  graphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true },
  namespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true },
}, { _id: false });

const SessionVisitAnchorSchema = new Schema({
  sourceAnchorId: { type: Schema.Types.ObjectId, default: null },
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  exhibitSlotId: { type: Schema.Types.ObjectId, ref: "ExhibitSlot", required: true },
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  placeId: { type: Schema.Types.ObjectId, required: true },
  estimatedObservationSeconds: { type: Number, min: 0, default: 0 },
  approachInstruction: { type: String, trim: true, default: null },
}, { _id: true });

const SessionPhysicalLegSchema = new Schema({
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

const TimingSchema = new Schema({
  contentSeconds: { type: Number, min: 0, default: 0 },
  observationSeconds: { type: Number, min: 0, default: 0 },
  logisticsSeconds: { type: Number, min: 0, default: 0 },
  totalSeconds: { type: Number, min: 0, default: 0 },
  reservedSeconds: { type: Number, min: 0, default: 0 },
}, { _id: false });

const SessionPlanRevisionV2Schema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSessionV2", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevisionV2", default: null },
  status: { type: String, enum: ["active", "superseded"], default: "active", index: true },
  origin: {
    sourceType: { type: String, enum: ["visit", "generated_plan"], required: true },
    visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null },
    generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlanV2", default: null },
  },
  createdReason: { type: String, enum: ["initial", "manual_request", "parameter_change", "route_only", "regenerated_tail"], default: "initial" },
  fidelity: { type: String, enum: ["preserve", "adapt", "regenerate"], default: "preserve" },
  executedThroughEntryIndex: { type: Number, min: -1, default: -1 },
  sourceEditorialReleaseIds: [{ type: Schema.Types.ObjectId, ref: "EditorialRelease" }],
  semanticGraphPins: { type: [SessionSemanticGraphPinSchema], default: [] },
  contentEntries: { type: [SessionContentEntrySchema], default: [] },
  visitAnchors: { type: [SessionVisitAnchorSchema], default: [] },
  physicalRoute: { legs: { type: [SessionPhysicalLegSchema], default: [] } },
  estimatedTiming: { type: TimingSchema, default: () => ({}) },
  explanation: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: "session_plan_revisions_v2" });

SessionPlanRevisionV2Schema.index({ sessionId: 1, version: 1 }, { unique: true });
SessionPlanRevisionV2Schema.index({ sessionId: 1, status: 1 });
module.exports = mongoose.model("SessionPlanRevisionV2", SessionPlanRevisionV2Schema);
