const mongoose = require("mongoose");
const IntegrityIssueSchema = require("./integrityIssue.schema");
const { Schema } = mongoose;

function versionedSchemaDependencySchema({ revisionRef }) {
  const ValidationSchema = new Schema({
    consumerSnapshotId: { type: Schema.Types.ObjectId, default: null },
    dependencyRevisionId: { type: Schema.Types.ObjectId, ref: revisionRef, default: null },
    status: { type: String, enum: ["valid", "needs_review"], default: "needs_review" },
    outcome: { type: String, enum: ["compatible", "auto_migrated", "requires_review"], default: null },
    issues: { type: [IntegrityIssueSchema], default: [] },
    checkedAt: { type: Date, default: null },
  }, { _id: false });

  return new Schema({
    versionPolicy: { type: String, enum: ["follow_current", "pinned"], required: true },
    pinnedRevisionId: { type: Schema.Types.ObjectId, ref: revisionRef, default: null },
    validation: { type: ValidationSchema, default: null },
  }, { _id: false });
}

module.exports = versionedSchemaDependencySchema;
