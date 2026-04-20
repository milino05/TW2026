const mongoose = require("mongoose");
const { Schema } = mongoose;

const RelationSchema = require("../schemas/relation.schema");
const RepresentationSchema = require("../schemas/representation.schema");
const museumConfig = require("./museum.model");

/**
 * Metadati generici dell'item.
 * Non mettiamo campi rigidi tipo "author" o "style":
 * questi stanno nelle relazioni.
 */
const ItemSchema = new Schema(
  {
    /**
     * Identificatore esterno leggibile o interoperabile.
     * Esempi:
     * - QID di Wikidata
     * - slug custom
     * - UUID esterno
     *
     * Non è obbligatorio, ma è molto utile.
     */
    externalId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },

    museumId: {
      type: Schema.Types.ObjectId,
      ref: "Museum",
      required: true,
      index: true,
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
    },

    /**
     * Nome leggibile principale dell'item.
     * È il campo principale con cui l'entità viene riconosciuta.
     * Esempi:
     * - "Girolamo Mazzola Bedoli"
     * - "Manierismo"
     * - "Ritratto di frate in veste di San Tommaso d'Aquino"
     */
    label: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Nome normalizzato dell'item (più stabile).
     * È il campo usato per le query -> non ho i problemi di maiuscole e spazi.
     * Esempi:
     * - "girolamo-mazzola-bedoli"
     * - "manierismo"
     * - "ritratto-di-frate-in-veste-di-san-tommaso-d'aquino"
     */
    slug: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /**
     * Immagine di riconoscimento opzionale.
     */
    recognitionImage: {
      url: { type: String, trim: true },
      altText: { type: String, trim: true },
    },

    /**
     * Tag liberi o semi-controllati.
     * Utile per filtri, ricerca interna, categorizzazione editoriale.
     */
    tags: [
      {
        type: String,
        trim: true,
      },
    ],

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
      type: Schema.Types.Mixed,
    },

    /**
     * Stato editoriale dell'item.
     */
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },

    createdBy: {
      type: String,
    },

    updatedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * ------------------------------------------------------------------
 * Indexes
 * ------------------------------------------------------------------
 * Gli indici servono a velocizzare le query più frequenti,
 * al costo di occupare spazio e rallentare leggermente scritture/aggiornamenti.
 */

/**
 * Text index per ricerca full-text di base.
 * Utile nel marketplace/editor per cercare item per nome, riassunto o tag.
 */
ItemSchema.index({ label: "text", tags: "text" });

/**
 * Indice utile quando cerchi item in base a una relazione.
 * Esempio:
 * "dammi tutti gli item che hanno relazione created_by verso X"
 */
ItemSchema.index({ "relations.relationTypeKey": 1, "relations.target": 1 });

/**
 * Indice utile per selezionare rappresentazioni per livello.
 * Esempio:
 * "cerco la versione livello elementare"
 */
ItemSchema.index({ "representations.languageLevel": 1 });

/**
 * Indice utile per filtrare o ordinare per durata delle rappresentazioni.
 */
ItemSchema.index({ "representations.durationKey": 1 });

// 1. Per la dashboard del museo: trova item per tipo e stato
// Esempio: "Tutti i pittori pubblicati del Museo A"
ItemSchema.index({ museumId: 1, itemType: 1, status: 1 });

// 3. Per la ricerca per ID esterno dentro un museo specifico
ItemSchema.index({ museumId: 1, externalId: 1 });

ItemSchema.index({ museumId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model("Item", ItemSchema);
