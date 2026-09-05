const mongoose = require("mongoose");
const { Schema } = mongoose;

const CollectionSubjectMembershipSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, immutable: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true, index: true },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "collection_subject_memberships_v2" });

CollectionSubjectMembershipSchema.index({ editorialContextId: 1, subjectId: 1 }, { unique: true });
CollectionSubjectMembershipSchema.index({ subjectId: 1, editorialContextId: 1 });

module.exports = mongoose.model("CollectionSubjectMembership", CollectionSubjectMembershipSchema);
