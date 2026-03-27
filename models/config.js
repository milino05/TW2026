const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  museoId: String,
  linguaggi: [String],   // es: ["facile", "medio", "avanzato"]
  lunghezze: [String]    // es: ["breve", "medio", "lungo"]
});