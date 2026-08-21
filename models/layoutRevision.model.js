const mongoose = require("mongoose");
const SemanticRefSchema = require("../schemas/semanticRef.schema");
const { Schema } = mongoose;

const PlaceTypeSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  userIntents: { type: [{ type: String, trim: true, uppercase: true }], default: [] },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
}, { _id: false });
const RoutingAttributeSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  dataType: { type: String, enum: ["boolean", "number", "string", "choice"], required: true },
  unit: { type: String, trim: true, default: null },
  options: { type: [{ type: String, trim: true }], default: [] },
  canonicalKey: { type: String, trim: true, lowercase: true, default: null },
  appliesTo: { type: String, enum: ["connection", "place", "both"], default: "connection" },
}, { _id: false });
const RoutingRequirementSchema = new Schema({
  attributeKey: { type: String, required: true, trim: true, lowercase: true },
  operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
  value: { type: Schema.Types.Mixed, required: true },
  priority: { type: String, enum: ["required", "preferred"], default: "preferred" },
  weight: { type: Number, min: 0, default: 1 },
}, { _id: false });
const RoutingPresetSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  requirements: { type: [RoutingRequirementSchema], default: [] },
}, { _id: false });
const FloorSchema = new Schema({
  key: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  map: {
    imageUrl: { type: String, trim: true, default: null },
    width: { type: Number, min: 1, default: null },
    height: { type: Number, min: 1, default: null },
  },
}, { _id: false });
const PlaceSchema = new Schema({
  typeKey: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  floorKey: { type: String, required: true, trim: true, lowercase: true },
  position: {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  attributes: { type: Schema.Types.Mixed, default: {} },
}, { _id: true });
const VenueTargetPlacementSchema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  primaryPlaceId: { type: Schema.Types.ObjectId, required: true },
  placeIds: { type: [Schema.Types.ObjectId], default: [] },
}, { _id: false });
const ConnectionSchema = new Schema({
  fromPlaceId: { type: Schema.Types.ObjectId, required: true },
  toPlaceId: { type: Schema.Types.ObjectId, required: true },
  directionality: { type: String, enum: ["directed", "bidirectional"], default: "bidirectional" },
  distanceMeters: { type: Number, required: true, min: 0.1 },
  additionalDelaySeconds: { type: Number, min: 0, default: 0 },
  attributes: { type: Schema.Types.Mixed, default: {} },
  instructions: {
    forward: { type: String, trim: true, default: null },
    backward: { type: String, trim: true, default: null },
  },
}, { _id: true });

const LayoutRevisionSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", default: null },
  placeTypes: { type: [PlaceTypeSchema], default: [] },
  routingAttributes: { type: [RoutingAttributeSchema], default: [] },
  routingPresets: { type: [RoutingPresetSchema], default: [] },
  floors: { type: [FloorSchema], default: [] },
  places: { type: [PlaceSchema], default: [] },
  venueTargetPlacements: { type: [VenueTargetPlacementSchema], default: [] },
  connections: { type: [ConnectionSchema], default: [] },
  status: { type: String, enum: ["draft", "published", "superseded"], default: "draft", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

LayoutRevisionSchema.index({ venueId: 1, version: 1 }, { unique: true });
LayoutRevisionSchema.index({ venueId: 1, status: 1, version: -1 });

module.exports = mongoose.model("LayoutRevision", LayoutRevisionSchema);
