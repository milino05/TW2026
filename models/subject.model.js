const mongoose = require("mongoose");
const SubjectExternalIdentitySchema = require("../schemas/subjectExternalIdentity.schema");
const { Schema } = mongoose;

const SubjectSchema = new Schema(
  {
    preferredLabel: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: "" },
    externalIdentities: { type: [SubjectExternalIdentitySchema], default: [] },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
  },
  { timestamps: true },
);

SubjectSchema.index({ preferredLabel: "text", description: "text" });
SubjectSchema.index(
  { preferredLabel: 1 },
  {
    name: "subject_preferred_label_exact_it",
    collation: { locale: "it", strength: 1, alternate: "shifted" },
  },
);
SubjectSchema.index(
  { "externalIdentities.scheme": 1, "externalIdentities.id": 1 },
  { unique: true, sparse: true, name: "unique_subject_external_identity" },
);

SubjectSchema.pre("validate", function validateExternalIdentities(next) {
  const identities = this.externalIdentities || [];
  const seen = new Set();
  const canonicalByScheme = new Map();

  for (const identity of identities) {
    const scheme = String(identity.scheme || "").trim().toLowerCase();
    const externalId = String(identity.id || "").trim();
    const key = `${scheme}::${externalId}`;
    if (seen.has(key)) {
      this.invalidate("externalIdentities", `Identita esterna duplicata: ${key}`);
    }
    seen.add(key);

    if (identity.role === "canonical") {
      if (canonicalByScheme.has(scheme)) {
        this.invalidate("externalIdentities", `Piu identita canoniche per lo scheme ${scheme}`);
      }
      canonicalByScheme.set(scheme, externalId);
      if (identity.canonicalId) {
        this.invalidate("externalIdentities", "Una identita canonica non puo dichiarare canonicalId");
      }
    } else if (!identity.canonicalId) {
      this.invalidate("externalIdentities", "Una identita storica deve dichiarare canonicalId");
    }
  }

  for (const identity of identities) {
    if (identity.role !== "historical") continue;
    const scheme = String(identity.scheme || "").trim().toLowerCase();
    if (canonicalByScheme.get(scheme) !== String(identity.canonicalId || "").trim()) {
      this.invalidate("externalIdentities", "canonicalId storico deve riferirsi all'identita canonica dello stesso scheme");
    }
  }

  next();
});

module.exports = mongoose.model("Subject", SubjectSchema);
