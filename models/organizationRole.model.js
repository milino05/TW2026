const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrganizationRoleSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, trim: true, lowercase: true },
  description: { type: String, trim: true, default: "" },
  permissionCodes: { type: [String], required: true, default: [] },
  starterKey: { type: String, trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

OrganizationRoleSchema.pre("validate", function normalizeRoleName(next) {
  this.normalizedName = String(this.name || "").trim().toLocaleLowerCase("it-IT");
  this.permissionCodes = [...new Set((this.permissionCodes || []).map((code) => String(code).trim()).filter(Boolean))].sort();
  next();
});

OrganizationRoleSchema.index({ organizationId: 1, normalizedName: 1 }, { unique: true });
OrganizationRoleSchema.index(
  { organizationId: 1, starterKey: 1 },
  { unique: true, partialFilterExpression: { starterKey: { $type: "string" } } },
);

module.exports = mongoose.model("OrganizationRole", OrganizationRoleSchema);
