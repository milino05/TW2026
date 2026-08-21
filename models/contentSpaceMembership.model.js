const mongoose = require("mongoose");
const { Schema } = mongoose;

const ContentSpaceMembershipSchema = new Schema({
  contentSpaceId: { type: Schema.Types.ObjectId, ref: "ContentSpace", required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true, index: true },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ContentSpaceMembershipSchema.index({ contentSpaceId: 1, itemId: 1 }, { unique: true });
ContentSpaceMembershipSchema.index({ itemId: 1, createdAt: 1 });

module.exports = mongoose.model("ContentSpaceMembership", ContentSpaceMembershipSchema);
