const mongoose = require("mongoose");
const { Schema } = mongoose;

const DurationTypeSchema = new Schema(
  {
    /**
     * Chiave tecnica stabile.
     * Non dovrebbe cambiare facilmente.
     * Esempi: "short", "medium", "long"
     */
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    /**
     * Etichetta leggibile mostrata all'utente o al gestore.
     * Esempi: "breve", "medio", "lungo"
     */
    label: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Livello di approfondimento/estensione.
     * Esempi: 1, 2, 3
     */
    level: {
      type: Number,
      required: true,
      min: 1,
    },

    /**
     * Descrizione opzionale per spiegare il significato editoriale.
     * Es: "Lunghezza consigliata: 40 caratteri"
     */
    description: {
      type: String,
      trim: true,
    },
  },
  {
    _id: true,
  },
);

module.exports = DurationTypeSchema;
