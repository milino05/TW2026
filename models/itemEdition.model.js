const mongoose = require("mongoose");
const { Schema } = mongoose;
const ItemEditionSchema = new Schema({ itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true, index: true }, namespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", required: true, index: true }, publishedRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", default: null, index: true }, workingRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", default: null, index: true }, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true, collection: "item_editions_v2" });
ItemEditionSchema.index({ itemId: 1, namespaceId: 1 }, { unique: true });
ItemEditionSchema.index({ namespaceId: 1, updatedAt: -1 });
module.exports = mongoose.model("ItemEdition", ItemEditionSchema);
