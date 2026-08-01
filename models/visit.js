const mongoose = require("mongoose");
const Item = require("./item.model");
const User = require("./user");
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
  {
    _id: true,
  },
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

VisitSchema.pre("validate", async function validateVisitDomain() {
  if (this.kind === "official" && !this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId e obbligatorio per una visita ufficiale");
  }

  if (this.kind === "community" && this.ownerMuseumId) {
    this.invalidate("ownerMuseumId", "ownerMuseumId deve essere assente per una visita community");
  }

  const creator = this.createdBy
    ? await User.findById(this.createdBy).select("status memberships").lean()
    : null;

  if (this.createdBy && !creator) {
    this.invalidate("createdBy", "L'utente creatore non esiste");
  } else if (creator?.status !== "active") {
    this.invalidate("createdBy", "L'utente creatore non e attivo");
  }

  if (this.kind === "official" && creator && this.ownerMuseumId) {
    const isOperator = (creator.memberships || []).some(
      (membership) =>
        String(membership.museumId) === String(this.ownerMuseumId) &&
        membership.role === "operator",
    );

    if (!isOperator) {
      this.invalidate(
        "createdBy",
        "Il creatore deve essere operatore del museo proprietario della visita",
      );
    }
  }

  const stopItemIds = (this.stops || []).map((stop) => stop.itemId).filter(Boolean);
  const items = stopItemIds.length
    ? await Item.find({ _id: { $in: stopItemIds } })
        .select("_id museumId status integrity.status")
        .lean()
    : [];

  const itemsById = new Map(items.map((item) => [String(item._id), item]));
  const museumIds = new Set();

  stopItemIds.forEach((itemId, index) => {
    const item = itemsById.get(String(itemId));

    if (!item) {
      this.invalidate(`stops.${index}.itemId`, "L'item della tappa non esiste");
      return;
    }

    museumIds.add(String(item.museumId));

    if (this.kind === "official" && String(item.museumId) !== String(this.ownerMuseumId)) {
      this.invalidate(
        `stops.${index}.itemId`,
        "Una visita ufficiale puo contenere soltanto item del museo proprietario",
      );
    }

    if (this.status === "published" && item.status !== "published") {
      this.invalidate(
        `stops.${index}.itemId`,
        "Una visita pubblicata puo contenere soltanto item pubblicati",
      );
    }

    if (this.status === "published" && item.integrity?.status !== "valid") {
      this.invalidate(
        `stops.${index}.itemId`,
        "Una visita pubblicata puo contenere soltanto item integri",
      );
    }
  });

  this.museumIds = Array.from(museumIds);

  if (this.status === "published" && stopItemIds.length === 0) {
    this.invalidate("stops", "Una visita pubblicata deve contenere almeno una tappa");
  }

  if (this.status === "published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  if (this.status === "draft") {
    this.publishedAt = null;
  }
});

VisitSchema.index({ kind: 1, status: 1, createdAt: -1 });
VisitSchema.index({ ownerMuseumId: 1, status: 1, createdAt: -1 });
VisitSchema.index({ createdBy: 1, status: 1, updatedAt: -1 });
VisitSchema.index({ museumIds: 1, kind: 1, status: 1 });

module.exports = mongoose.model("Visit", VisitSchema);
