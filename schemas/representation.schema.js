/**
 * Rappresentazione alternativa dello stesso item.
 * Serve per gestire:
 * - durata diversa
 * - livello linguistico diverso
 * - lingua diversa
 * - testo diverso
 */

const museumConfig = require("../config/museum.config");

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

      /*funzione che valuta se il valore stringa salvato è incluso 
      nell'array dei linguaggi di config 
      (non basta enum se vogliamo cambiare dinamicamente il config) */
      validate: {
        validator: function(value) {
          return museumConfig.languageLevels.includes(value);
        },
        message: props => `${props.value} non è un languageLevel valido`
      }
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


     /**
     * Flag utile per indicare la rappresentazione "predefinita"
     * quando non ci sono preferenze specifiche dell'utente.
     */
    isDefault: { //caso in cui non specifichi come vuoi la visita
      type: Boolean,
      default: false
    }
  },
  { _id: true }
);

module.exports = RepresentationSchema;