const mongoose = require("mongoose");
const { Schema } = mongoose;
const museumConfig = require("../config/museum.config");

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
    durationKey: {
      type: String,
      required: true,
      trim: true,
    },

    languageLevel: {
      type: String,
      required: true,
    },

    text: {
      //il vero contenuto dell'item
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Flag utile per indicare la rappresentazione "predefinita"
     * quando non ci sono preferenze specifiche dell'utente.
     */
    isDefault: {
      //caso in cui non specifichi come vuoi la visita
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

module.exports = RepresentationSchema;
