const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserContentExposureV2Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true, index: true },
  variantId: { type: Schema.Types.ObjectId, required: true, index: true },
  representationId: { type: Schema.Types.ObjectId, required: true, index: true },
  lastItemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  exposureCount: { type: Number, min: 0, default: 0 },
  completionEma: { type: Number, min: 0, max: 1, default: 0 },
  lastExposedAt: { type: Date, default: null },
}, { timestamps: true, collection: "user_content_exposures_v2" });

UserContentExposureV2Schema.index(
  { userId: 1, itemEditionId: 1, variantId: 1, representationId: 1 },
  { unique: true },
);
UserContentExposureV2Schema.index({ userId: 1, itemEditionId: 1, lastExposedAt: -1 });

module.exports = mongoose.model("UserContentExposureV2", UserContentExposureV2Schema);
