const mongoose = require("mongoose");
const { Schema } = mongoose;

const RoleAssignmentSchema = new Schema({
  roleId: { type: Schema.Types.ObjectId, ref: "OrganizationRole", required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

const OrganizationMembershipSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  roleAssignments: {
    type: [RoleAssignmentSchema],
    required: true,
    validate: {
      validator(value) {
        if (!Array.isArray(value) || value.length === 0) return false;
        return new Set(value.map((entry) => String(entry.roleId))).size === value.length;
      },
      message: "Una membership attiva richiede almeno un ruolo senza duplicati",
    },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

OrganizationMembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
OrganizationMembershipSchema.index({ organizationId: 1, "roleAssignments.roleId": 1 });

module.exports = mongoose.model("OrganizationMembership", OrganizationMembershipSchema);
