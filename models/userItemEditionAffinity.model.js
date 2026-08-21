const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserItemEditionAffinitySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true, index: true },
  value: { type: Number, min: -1, max: 1, default: 0 },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
}, { timestamps: true, collection: "user_item_edition_affinities_v2" });

UserItemEditionAffinitySchema.index({ userId: 1, itemEditionId: 1 }, { unique: true });

module.exports = mongoose.model("UserItemEditionAffinity", UserItemEditionAffinitySchema);
