const mongoose = require("mongoose");
const { Schema } = mongoose;

const MuseumSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
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

module.exports = mongoose.model("Museum", MuseumSchema);
