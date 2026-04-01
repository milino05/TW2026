const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  codice: { type: String, required: true }, //codice wikidata
  nome: { type: String, required: true }, //opera, artista, periodo storico, ecc..
  riferimenti: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Item" }
  ], //possibilità di aggiungere collegamenti ad altri item
  contenuti: [
    {
      linguaggio: { type: String, required: true }, //facile, difficile, ecc..
      lunghezza: { type: String, required: true }, //breve, lunga, ecc..
      contenuto: { type: String, required: true }
    }
  ]
});

module.exports = mongoose.model("Item", itemSchema);


//.-----------------------------------------------------------------------


const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Rappresentazione alternativa dello stesso item.
 * Serve per gestire:
 * - durata diversa
 * - livello linguistico diverso
 * - lingua diversa
 * - testo diverso
 */
const RepresentationSchema = new Schema(
  {
    duration: {
      type: String,
      required: true,
      enum: ["3s", "15s", "40s", "1min", "4min"]
    },

    languageLevel: {
      type: String,
      required: true,
      enum: ["infantile", "elementare", "medio", "specialistico", "avanzato"]
    },

    language: {
      type: String,
      default: "it", //riferimento al config per la lingua di default
      enum: ["eng", "it"] 
    },

    text: { //il vero contenuto dell'item
      type: String,
      required: true,
      trim: true
    },

    isDefault: { //caso in cui non specifichi come vuoi la visita
      type: Boolean,
      default: false
    }
  },
  { _id: true }
);

/**
 * Relazione generica tra item.
 * Esempi:
 * - created_by
 * - has_style
 * - depicts
 * - located_in
 * - same_period_as
 * - related_to
 */
const RelationSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      enum: ["created_by", "has_style"] //fa riferimento al file relationTypes
    },

    target: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true
    },

    label: {
      type: String,
      trim: true
    },

    weight: {
      type: Number,
      default: 1
    },

    direction: {
      type: String,
      enum: ["outgoing", "incoming", "bidirectional"],
      default: "outgoing"
    }
  },
  { _id: true }
);

/**
 * Metadati generici dell'item.
 * Non mettiamo campi rigidi tipo "author" o "style":
 * questi stanno nelle relazioni.
 */
const ItemSchema = new Schema(
  {
    /**
     * Identificatore interno/esterno leggibile.
     * Può essere usato per QID, UUID, slug, ecc.
     */
    externalId: {
      type: String,
      trim: true,
      index: true,
      sparse: true
    },

    /**
     * Tipo generico dell'entità.
     * Non obbligatorio in senso assoluto, ma molto utile.
     */
    itemType: {
      type: String,
      required: true,
      trim: true,
      index: true,
      enum: ["artista", "opera", "periodo storico", "locazione", "stile", "corrente artistica"]
    },

    /**
     * Nome leggibile principale.
     * Esempi:
     * - "Girolamo Mazzola Bedoli"
     * - "Manierismo"
     * - "Ritratto di frate in veste di San Tommaso d'Aquino"
     */
    label: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    /**
     * Immagine di riconoscimento opzionale.
     */
    recognitionImage: {
      url: { type: String, trim: true },
      altText: { type: String, trim: true }
    },

    /**
     * Metadati generici.
     */
    metadata: {
      license: { type: String, trim: true },
    },

    /**
     * Relazioni verso altri item.
     */
    relations: [RelationSchema],

    /**
     * Modi diversi di rappresentare/raccontare questo item.
     */
    representations: [RepresentationSchema],

    /**
     * JSON-LD opzionale, come layer semantico/export.
     */
    jsonld: {
      type: Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

/**
 * Indici utili
 */
ItemSchema.index({ label: "text", summary: "text", tags: "text" });
ItemSchema.index({ "relations.type": 1, "relations.target": 1 });
ItemSchema.index({ "representations.language": 1, "representations.languageLevel": 1 });
ItemSchema.index({ "representations.duration": 1 });

module.exports = mongoose.model("Item", ItemSchema);
