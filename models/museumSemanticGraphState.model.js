const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Versione tecnica della vista published del knowledge graph.
 * Non contiene nodi o archi e non e fonte di verita: serve solo a invalidare
 * cache in-memory tra processi quando cambia la vista pubblicata.
 */
const MuseumSemanticGraphStateSchema = new Schema({
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, unique: true, index: true },
  publishedEpoch: { type: Number, min: 1, default: 1 },
  lastPublishedChangeAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("MuseumSemanticGraphState", MuseumSemanticGraphStateSchema);
