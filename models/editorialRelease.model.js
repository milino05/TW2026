const mongoose = require("mongoose");
const EditorialItemBindingSchema = require("../schemas/editorialItemBinding.schema");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

const EditorialReleaseSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, index: true, immutable: true },
  sourceContextRevisionId: { type: Schema.Types.ObjectId, ref: "EditorialContextRevision", default: null, index: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  basedOnReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null, immutable: true },
  namespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true, index: true, immutable: true },
  graphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true, index: true, immutable: true },
  itemBindings: { type: [EditorialItemBindingSchema], default: [], immutable: true },
  integrity: {
    status: { type: String, enum: ["valid"], default: "valid", immutable: true },
    issues: { type: [IntegrityIssueSchema], default: [], immutable: true },
    checkedAt: { type: Date, required: true, immutable: true },
    checkedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  },
  releasedAt: { type: Date, required: true, immutable: true },
  releasedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "editorial_releases_v2" });

EditorialReleaseSchema.index({ editorialContextId: 1, version: 1 }, { unique: true });
EditorialReleaseSchema.index({ editorialContextId: 1, releasedAt: -1 });
EditorialReleaseSchema.index({ "itemBindings.itemEditionId": 1, "itemBindings.itemRevisionId": 1 });

module.exports = mongoose.model("EditorialRelease", EditorialReleaseSchema);
