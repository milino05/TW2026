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
