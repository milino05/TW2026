const mongoose = require("mongoose");
const { Schema } = mongoose;

const ContentSpaceItemMembershipSchema = new Schema({
  contentSpaceId: { type: Schema.Types.ObjectId, ref: "ContentSpace", required: true, immutable: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true, immutable: true, index: true },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "content_space_item_memberships_v2" });

ContentSpaceItemMembershipSchema.index({ contentSpaceId: 1, itemId: 1 }, { unique: true });
ContentSpaceItemMembershipSchema.index({ itemId: 1, createdAt: 1 });

module.exports = mongoose.model("ContentSpaceItemMembership", ContentSpaceItemMembershipSchema);
