/*
  ArtAround Backend - Minimal API Server
  Compatibile con deploy dipartimento
*/

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

/*
  ⚠️ SOSTITUIRE con le credenziali fornite dal dipartimento
*/
const mongoCredentials = {
  user: "site252605",
  pwd: "Quei6kee",
  site: "mongo_site252605"
};

// Stringa di connessione MongoDB
const mongoURI = `mongodb://${mongoCredentials.user}:${mongoCredentials.pwd}@localhost:27017/${mongoCredentials.site}?authSource=admin`;

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
app.get("/api/ping", (req, res) => {
  res.json({
    status: "ok",
    message: "ArtAround backend attivo",
    time: new Date()
  });
});

app.get('/', async function(req, res) { 
	var text = "Milo bastardo che gioca a Minecraft";
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

const PORT = 8000;

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});
