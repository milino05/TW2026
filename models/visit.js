const mongoose = require("mongoose");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

/**
 * Una tappa contiene soltanto l'item principale della visita.
 * Le rappresentazioni alternative e gli approfondimenti tematici restano
 * responsabilita dell'item e delle sue relazioni, senza diventare nuove tappe.
 */
const VisitStopSchema = new Schema(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },

    optional: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

const VisitSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    kind: {
      type: String,
      enum: ["official", "community"],
      required: true,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /** Museo responsabile editoriale: presente solo per visite ufficiali. */
    ownerMuseumId: {
      type: Schema.Types.ObjectId,
      ref: "Museum",
      default: null,
      index: true,
    },

    /** L'ordine dell'array e l'unica fonte dell'ordine delle tappe. */
    stops: {
      type: [VisitStopSchema],
      default: [],
    },

    /** Campo derivato dal backend a partire dagli item presenti nelle tappe. */
    museumIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Museum" }],
      default: [],
      index: true,
    },

    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },

    publishedAt: { type: Date, default: null },

    integrity: {
      status: {
        type: String,
        enum: ["valid", "needs_review"],
        default: "valid",
        index: true,
      },
      issues: { type: [IntegrityIssueSchema], default: [] },
    },
  },
  { timestamps: true },
);

VisitSchema.pre("validate", function validateVisitOwnership(next) {
  if (this.kind === "official" && !this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId e obbligatorio per una visita ufficiale");
  }

  if (this.kind === "community" && this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId deve essere assente per una visita community");
  }

  if (this.status === "draft") {
    this.publishedAt = null;
  }

  next();
});

VisitSchema.index({ kind: 1, status: 1, createdAt: -1 });
VisitSchema.index({ ownerMuseumId: 1, status: 1, createdAt: -1 });
VisitSchema.index({ createdBy: 1, status: 1, updatedAt: -1 });
VisitSchema.index({ museumIds: 1, kind: 1, status: 1 });

module.exports = mongoose.model("Visit", VisitSchema);
