/*
  ArtAround Backend - Minimal API Server
  Compatibile con deploy dipartimento
*/
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

/* ========================= */
/*        CONFIGURAZIONE     */
/* ========================= */

const app = express();

// Permette al server di ricevere JSON nel body delle richieste
app.use(express.json());

// Permette richieste da frontend esterni (es. Vue)
app.use(cors());

// Necessario quando si è dietro proxy (come nel server del dipartimento)
app.enable("trust proxy");
app.use(express.static(__dirname));

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
/*         ROUTE TEST        */
/* ========================= */

// Endpoint base per verificare che il server funzioni
app.get("/ping", (req, res) => {
  res.json({
    status: "ok",
    message: "ArtAround backend attivo",
    time: new Date()
  });
});

app.get('/', async function(req, res) { 
	var text = "Milo bastardo che gioca a Path of Exile";
	res.send(
`<!doctype html>
<html>
	<body>
		<h1>${text}</h1>
		<img src="Shrek.jpg" alt="basstardoh">
	</body>
</html>
			`)
});

/* ========================= */
/*       AVVIO SERVER        */
/* ========================= */

const PORT = process.env.PORT||8000;

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});
