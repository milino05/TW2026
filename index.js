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

mongoose.connect(mongoURI)
  .then(() => {
    console.log("✅ Connessione a MongoDB riuscita");
  })
  .catch((err) => {
    console.error("❌ Errore connessione MongoDB:", err);
  });



/* ========================= */
/*       AVVIO SERVER        */
/* ========================= */

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});
