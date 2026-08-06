const mongoose = require("mongoose");
const { Schema } = mongoose;

const IntegrityIssueSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    field: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    severity: {
      type: String,
      enum: ["warning", "error"],
      default: "error",
    },
    context: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

module.exports = IntegrityIssueSchema;
