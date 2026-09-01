const mongoose = require("mongoose");
const { Schema } = mongoose;

const CurationSignalSchema = new Schema({
  definitionId: { type: String, required: true, trim: true },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const EditorialContextEntrySchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, immutable: true, index: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true, immutable: true, index: true },
  curationSignals: { type: [CurationSignalSchema], default: [] },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, collection: "editorial_context_entries_v2" });

EditorialContextEntrySchema.index({ editorialContextId: 1, itemEditionId: 1 }, { unique: true });
EditorialContextEntrySchema.index({ editorialContextId: 1, createdAt: 1, _id: 1 });

module.exports = mongoose.model("EditorialContextEntry", EditorialContextEntrySchema);
