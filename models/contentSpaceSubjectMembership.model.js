const mongoose = require("mongoose");
const { Schema } = mongoose;

const ContentSpaceSubjectMembershipSchema = new Schema({
  contentSpaceId: { type: Schema.Types.ObjectId, ref: "ContentSpace", required: true, immutable: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true, index: true },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "content_space_subject_memberships_v2" });

ContentSpaceSubjectMembershipSchema.index({ contentSpaceId: 1, subjectId: 1 }, { unique: true });
ContentSpaceSubjectMembershipSchema.index({ subjectId: 1, createdAt: 1 });

module.exports = mongoose.model("ContentSpaceSubjectMembership", ContentSpaceSubjectMembershipSchema);
