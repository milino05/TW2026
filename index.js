/*
  ArtAround Backend - Minimal API Server
  Compatibile con deploy dipartimento
*/
require("dotenv").config();
const mongoose = require("mongoose");
const cors = require("cors");
const app = require("./app");

/* ========================= */
/*        CONNESSIONE DB     */
/* ========================= */

// Stringa di connessione MongoDB
const mongoURI = process.env.MONGO_URI;
const PORT = process.env.PORT || 8000;

async function startServer() {
  try {
    await mongoose.connect(mongoURI);
    console.log("✅ Connessione a MongoDB riuscita");

    app.listen(PORT, () => {
      console.log(`🚀 Server avviato su porta ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Errore connessione MongoDB:", err);
    process.exit(1);
  }
}

/* ========================= */
/*       AVVIO SERVER        */
/* ========================= */

startServer();
