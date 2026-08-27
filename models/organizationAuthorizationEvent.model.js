const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrganizationAuthorizationEventSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  eventType: {
    type: String,
    required: true,
    enum: [
      "organization.created",
      "organization.updated",
      "membership.created",
      "membership.roles.updated",
      "membership.removed",
      "role.created",
      "role.updated",
      "role.removed",
      "owner.granted",
      "owner.revoked",
    ],
  },
  targetType: { type: String, enum: ["organization", "membership", "role", "owner"], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  details: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

OrganizationAuthorizationEventSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model("OrganizationAuthorizationEvent", OrganizationAuthorizationEventSchema);
