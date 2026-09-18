const mongoose = require("mongoose");
const { Schema } = mongoose;

const NavigatorAssetSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  mimeType: { type: String, required: true, trim: true },
  fileName: { type: String, required: true, trim: true },
  byteLength: { type: Number, required: true, min: 1 },
  data: { type: Buffer, required: true, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, collection: "navigator_assets" });

NavigatorAssetSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model("NavigatorAsset", NavigatorAssetSchema);
