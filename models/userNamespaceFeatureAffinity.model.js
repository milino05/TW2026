const mongoose = require("mongoose");
const { Schema } = mongoose;

const FEATURE_KINDS = ["subject_class", "relation_type", "presentation_aspect", "selection_signal"];

const UserNamespaceFeatureAffinitySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  namespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", required: true, index: true },
  kind: { type: String, enum: FEATURE_KINDS, required: true, index: true },
  definitionId: { type: String, required: true, trim: true, index: true },
  value: { type: Number, min: -1, max: 1, default: 0 },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
}, { timestamps: true, collection: "user_namespace_feature_affinities_v2" });

UserNamespaceFeatureAffinitySchema.index(
  { userId: 1, namespaceId: 1, kind: 1, definitionId: 1 },
  { unique: true },
);

module.exports = mongoose.model("UserNamespaceFeatureAffinity", UserNamespaceFeatureAffinitySchema);
module.exports.FEATURE_KINDS = FEATURE_KINDS;
