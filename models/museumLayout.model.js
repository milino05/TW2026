const mongoose = require("mongoose");
const { Schema } = mongoose;

const MuseumLayoutSchema = new Schema(
  {
    museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, unique: true, index: true },
    publishedRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
    workingRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null },
    lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MuseumLayout", MuseumLayoutSchema);
