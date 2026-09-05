const mongoose = require("mongoose");
const { Schema } = mongoose;

const CurationSignalSchema = new Schema({
  definitionId: { type: String, required: true, trim: true },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const CollectionItemMembershipSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, immutable: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true, immutable: true, index: true },
  curationSignals: { type: [CurationSignalSchema], default: [] },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, collection: "collection_item_memberships_v2" });

CollectionItemMembershipSchema.index({ editorialContextId: 1, itemId: 1 }, { unique: true });
CollectionItemMembershipSchema.index({ editorialContextId: 1, createdAt: 1, _id: 1 });
CollectionItemMembershipSchema.index({ itemId: 1, editorialContextId: 1 });

module.exports = mongoose.model("CollectionItemMembership", CollectionItemMembershipSchema);
