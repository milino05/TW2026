const mongoose = require("mongoose");
const { Schema } = mongoose;

/** Identita stabile della visita. Titolo, tappe e policy vivono in VisitRevision. */
const VisitSchema = new Schema(
  {
    kind: { type: String, enum: ["official", "community"], required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerMuseumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null, index: true },
    publishedRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", default: null, index: true },
    workingRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", default: null, index: true },
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

VisitSchema.pre("validate", function validateOwnership(next) {
  if (this.kind === "official" && !this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId e obbligatorio per una visita ufficiale");
  }
  if (this.kind === "community" && this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId deve essere assente per una visita community");
  }
  next();
});

VisitSchema.index({ kind: 1, lifecycleStatus: 1, createdAt: -1 });
VisitSchema.index({ ownerMuseumId: 1, lifecycleStatus: 1, createdAt: -1 });
module.exports = mongoose.model("Visit", VisitSchema);
