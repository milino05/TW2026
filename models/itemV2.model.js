const mongoose = require("mongoose");
const { Schema } = mongoose;
const ProvenanceSchema = new Schema({ origin: { type: String, enum: ["human", "ai_assisted", "ai_generated", "imported", "forked"], default: "human" }, sourceItemId: { type: Schema.Types.ObjectId, ref: "ItemV2", default: null }, metadata: { type: Schema.Types.Mixed, default: null } }, { _id: false });
const ItemV2Schema = new Schema({ primarySubjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true }, ownerType: { type: String, enum: ["user", "organization"], required: true, index: true }, ownerId: { type: Schema.Types.ObjectId, required: true, index: true }, provenance: { type: ProvenanceSchema, default: () => ({ origin: "human" }) }, lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true }, trashedAt: { type: Date, default: null }, trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true, collection: "items_v2" });
ItemV2Schema.index({ ownerType: 1, ownerId: 1, lifecycleStatus: 1, updatedAt: -1 });
ItemV2Schema.index({ primarySubjectId: 1, lifecycleStatus: 1 });
module.exports = mongoose.model("ItemV2", ItemV2Schema);
