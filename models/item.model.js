const mongoose = require("mongoose");
const { Schema } = mongoose;

/** Identita stabile di un contenuto. I dati editoriali vivono in ItemRevision. */
const ItemSchema = new Schema(
  {
    externalId: { type: String, trim: true, index: true, sparse: true },
    museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
    itemType: { type: String, required: true, trim: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    publishedRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "ItemRevision",
      default: null,
      index: true,
    },
    workingRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "ItemRevision",
      default: null,
      index: true,
    },

    lifecycleStatus: {
      type: String,
      enum: ["active", "trashed"],
      default: "active",
      index: true,
    },
    trashedAt: { type: Date, default: null },
    trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

ItemSchema.index({ museumId: 1, externalId: 1 });
ItemSchema.index({ museumId: 1, itemType: 1, lifecycleStatus: 1 });
module.exports = mongoose.model("Item", ItemSchema);
