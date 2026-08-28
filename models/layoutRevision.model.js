const mongoose = require("mongoose");
const { Schema } = mongoose;

const NormalizedPointSchema = new Schema({
  x: { type: Number, required: true, min: 0, max: 1 },
  y: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const ManagedMapAssetSchema = new Schema({
  url: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, trim: true, lowercase: true },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  originalName: { type: String, trim: true, default: null },
}, { _id: false });

const FloorCalibrationSchema = new Schema({
  method: { type: String, enum: ["line", "connection"], required: true },
  distanceMeters: { type: Number, required: true, min: 0.01 },
  metersPerPixel: { type: Number, required: true, min: Number.EPSILON },
  line: {
    type: new Schema({
      from: { type: NormalizedPointSchema, required: true },
      to: { type: NormalizedPointSchema, required: true },
    }, { _id: false }),
    default: null,
  },
  referenceConnectionId: { type: Schema.Types.ObjectId, default: null },
}, { _id: false });

const FloorSchema = new Schema({
  label: { type: String, required: true, trim: true },
  mapAsset: { type: ManagedMapAssetSchema, default: null },
  calibration: { type: FloorCalibrationSchema, default: null },
});

const PhysicalAttributeValueSchema = new Schema({
  physicalAttributeDefinitionId: { type: String, required: true, trim: true },
  value: { type: Schema.Types.Mixed, required: true },
}, { _id: false });

const PlaceSchema = new Schema({
  floorId: { type: Schema.Types.ObjectId, required: true },
  placeTypeDefinitionId: { type: String, required: true, trim: true },
  label: { type: String, trim: true, default: null },
  position: { type: NormalizedPointSchema, required: true },
  attributeValues: { type: [PhysicalAttributeValueSchema], default: [] },
});

const VenueTargetPlacementSchema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
  primaryPlaceId: { type: Schema.Types.ObjectId, required: true },
  placeIds: { type: [Schema.Types.ObjectId], default: [] },
}, { _id: false });

const ConnectionGeometrySchema = new Schema({
  points: { type: [NormalizedPointSchema], default: [] },
}, { _id: false });

const ConnectionSchema = new Schema({
  fromPlaceId: { type: Schema.Types.ObjectId, required: true },
  toPlaceId: { type: Schema.Types.ObjectId, required: true },
  directionality: { type: String, enum: ["directed", "bidirectional"], default: "bidirectional" },
  connectionTypeDefinitionId: { type: String, trim: true, default: null },
  geometry: { type: ConnectionGeometrySchema, default: null },
  metricMode: { type: String, enum: ["geometry_derived", "length_constrained", "manual_override"], required: true },
  distanceMeters: { type: Number, required: true, min: 0.1 },
  additionalDelaySeconds: { type: Number, min: 0, default: 0 },
  attributeValues: { type: [PhysicalAttributeValueSchema], default: [] },
  instructions: {
    forward: { type: String, trim: true, default: null },
    backward: { type: String, trim: true, default: null },
  },
});

const LayoutRevisionSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "LayoutRevision", default: null },
  authoredAgainstPhysicalVocabularyRevisionId: {
    type: Schema.Types.ObjectId,
    ref: "PhysicalVocabularyRevision",
    required: true,
    immutable: true,
    index: true,
  },
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
