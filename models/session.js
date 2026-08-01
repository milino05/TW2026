const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Sessione server-side. Nel browser viene conservato soltanto il token casuale
 * dentro un cookie HttpOnly; nel database viene salvato esclusivamente il suo hash.
 */
const SessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },

    userAgent: {
      type: String,
      trim: true,
    },

    ipAddress: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

// MongoDB elimina automaticamente le sessioni scadute.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", SessionSchema);
