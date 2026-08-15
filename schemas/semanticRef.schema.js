const mongoose = require("mongoose");
const { Schema } = mongoose;

const SemanticRefSchema = new Schema(
  {
    scheme: { type: String, required: true, trim: true, lowercase: true },
    id: { type: String, required: true, trim: true },
    matchType: {
      type: String,
      enum: ["exact", "close", "broader", "narrower"],
      default: "exact",
    },
  },
  { _id: false },
);

module.exports = SemanticRefSchema;
