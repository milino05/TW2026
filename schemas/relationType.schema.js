const mongoose = require("mongoose");
const { Schema } = mongoose;

const RelationTypeSchema = new Schema(
  {
    /**
     * Chiave univoca usata nelle singole relations.
     * Esempio: "created_by"
     */
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    /**
     * Etichetta leggibile da mostrare in editor/admin.
     * Esempio: "creato da"
     */
    label: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Spiegazione semantica della relazione.
     */
    description: {
      type: String,
      trim: true,
    },

    /**
     * Tipi di item ammessi come sorgente della relazione.
     * Esempio: ["artwork"]
     */
    domain: [
      {
        type: String,
        trim: true,
      },
    ],

    /**
     * Tipi di item ammessi come destinazione della relazione.
     * Esempio: ["artist"]
     */
    range: [
      {
        type: String,
        trim: true,
      },
    ],

    /**
     * Categoria funzionale della relazione.
     * semantic  = significato culturale/contenutistico
     * logistic  = orientamento e spazi
     * contextual = legame laterale / storico / associativo
     * editorial = organizzazione contenuti
     */
    category: {
      type: String,
      required: true,
      enum: ["semantic", "logistic", "contextual", "editorial"],
    },

    /**
     * Forza generale del tipo di relazione.
     * Serve a dare priorità in esplorazione del grafo.
     */
    strength: {
      type: String,
      enum: ["strong", "medium", "weak"],
      default: "medium",
    },

    /**
     * Intenti utente a cui questa relazione può rispondere.
     * Esempio:
     * ["ASK_AUTHOR", "ASK_CREATOR"]
     */
    userIntents: [
      {
        type: String,
        trim: true,
      },
    ],

    /**
     * Chiave della relazione inversa, se esiste.
     * Esempio:
     * created_by <-> creator_of
     */
    inverseKey: {
      type: String,
      trim: true,
      lowercase: true,
    },

    /**
     * Regole di validazione applicativa.
     * Non è Mongo a farle rispettare da solo:
     * le usi nel backend/editor.
     */
    validationRules: {
      /**
       * Se false, non vuoi più target con questa relazione
       * sullo stesso item.
       * Esempio: un'opera dovrebbe avere un solo created_by.
       */
      allowMultiple: {
        type: Boolean,
        default: true,
      },

      /**
       * Se true, il target è obbligatorio
       * (in pratica quasi sempre lo è).
       */
      targetRequired: {
        type: Boolean,
        default: true,
      },
    },
  },
  { timestamps: true },
);

module.exports = RelationTypeSchema;
