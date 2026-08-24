const mongoose = require("mongoose");
const { Schema } = mongoose;

const SubjectExternalIdentitySchema = new Schema(
  {
    scheme: { type: String, required: true, trim: true, lowercase: true },
    id: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["canonical", "historical"],
      default: "canonical",
      required: true,
    },
    canonicalId: { type: String, trim: true, default: null },
    confirmation: {
      source: {
        type: String,
        enum: ["resolver", "seed"],
        required: true,
      },
      confirmedAt: { type: Date, required: true },
      confirmedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    verification: {
      status: {
        type: String,
        enum: ["verified", "unverified", "redirected", "not_found", "unavailable"],
        required: true,
      },
      checkedAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

module.exports = SubjectExternalIdentitySchema;
