const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Associazione tra un utente e i musei per i quali puo operare.
 * L'autorizzazione da operatore e sempre contestuale a uno specifico museo.
 */
const MuseumMembershipSchema = new Schema(
  {
    museumId: {
      type: Schema.Types.ObjectId,
      ref: "Museum",
      required: true,
    },

    role: {
      type: String,
      enum: ["operator"],
      default: "operator",
      required: true,
    },
  },
  {
    _id: false,
  },
);

const UserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    /**
     * Il modello memorizza soltanto l'hash. Algoritmo, login e gestione
     * sessione/token restano responsabilita del futuro livello auth.
     */
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    memberships: {
      type: [MuseumMembershipSchema],
      default: [],
    },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.pre("validate", function validateUniqueMuseumMemberships(next) {
  const seenMuseumIds = new Set();

  for (const membership of this.memberships || []) {
    const museumId = String(membership.museumId || "");

    if (!museumId) {
      continue;
    }

    if (seenMuseumIds.has(museumId)) {
      this.invalidate("memberships", "Uno stesso museo puo comparire una sola volta nelle memberships");
      break;
    }

    seenMuseumIds.add(museumId);
  }

  next();
});

UserSchema.index({ "memberships.museumId": 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
