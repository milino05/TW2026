const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: "" },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
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

OrganizationSchema.index({ lifecycleStatus: 1, name: 1 });

module.exports = mongoose.model("Organization", OrganizationSchema);
