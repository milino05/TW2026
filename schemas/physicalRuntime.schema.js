const mongoose = require("mongoose");
const PhysicalFeatureRefSchema = require("./physicalFeatureRef.schema");
const { Schema } = mongoose;

const KNOWN_LOCATION_SOURCES = [
  "manual_selection",
  "navigation_confirmation",
  "qr",
  "teleport",
  "geolocation",
];

const KnownLocationSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  placeId: { type: Schema.Types.ObjectId, required: true },
  visitAnchorId: { type: Schema.Types.ObjectId, default: null },
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", default: null },
  exhibitSlotId: { type: Schema.Types.ObjectId, ref: "ExhibitSlot", default: null },
  source: { type: String, enum: KNOWN_LOCATION_SOURCES, required: true },
  providerId: { type: String, trim: true, default: null },
  observedAt: { type: Date, required: true },
  acceptedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

const PhysicalDetourDestinationSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: "Venue", required: true },
  placeId: { type: Schema.Types.ObjectId, required: true },
  physicalFeatureRef: { type: PhysicalFeatureRefSchema, default: null },
}, { _id: false });

PhysicalDetourDestinationSchema.pre("validate", function validateResolvedDestination(next) {
  if (this.physicalFeatureRef && this.physicalFeatureRef.kind !== "local") {
    return next(new Error("Una deviazione runtime deve puntare a un PhysicalFeatureRef locale già risolto"));
  }
  return next();
});

const PhysicalDetourSchema = new Schema({
  destination: { type: PhysicalDetourDestinationSchema, required: true },
  startedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

const PhysicalRuntimeSchema = new Schema({
  knownLocation: { type: KnownLocationSchema, default: null },
  detour: { type: PhysicalDetourSchema, default: null },
}, { _id: false });

module.exports = PhysicalRuntimeSchema;
module.exports.KNOWN_LOCATION_SOURCES = KNOWN_LOCATION_SOURCES;
