const mongoose = require("mongoose");
const { Schema } = mongoose;

const CurationSignalSchema = new Schema({
  definitionId: { type: String, required: true, trim: true },
  weight: { type: Number, min: 0, max: 1, default: 1 },
}, { _id: false });

const EditorialItemBindingSchema = new Schema({
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  curationSignals: { type: [CurationSignalSchema], default: [] },
}, { _id: true });

module.exports = EditorialItemBindingSchema;
