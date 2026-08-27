const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrganizationOwnerSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  grantedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  grantedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

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
    owners: {
      type: [OrganizationOwnerSchema],
      required: true,
      validate: {
        validator(value) {
          if (!Array.isArray(value) || value.length === 0) return false;
          return new Set(value.map((entry) => String(entry.userId))).size === value.length;
        },
        message: "Un'organizzazione deve avere almeno un Owner e non puo contenerne duplicati",
      },
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
OrganizationSchema.index({ "owners.userId": 1, lifecycleStatus: 1 });

OrganizationSchema.pre("validate", function initializeCreatorOwner(next) {
  if ((!this.owners || this.owners.length === 0) && this.createdBy) {
    this.owners = [{ userId: this.createdBy, grantedBy: this.createdBy, grantedAt: this.createdAt || new Date() }];
  }
  next();
});

module.exports = mongoose.model("Organization", OrganizationSchema);
