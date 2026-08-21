const mongoose = require("mongoose");
const { Schema } = mongoose;

const ContentSpaceSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true, default: null },
  ownerType: { type: String, enum: ["user", "organization"], required: true, index: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ContentSpaceSchema.index({ ownerType: 1, ownerId: 1, lifecycleStatus: 1, name: 1 });

module.exports = mongoose.model("ContentSpace", ContentSpaceSchema);
