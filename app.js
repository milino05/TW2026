/* ========================= */
/*        CONFIGURAZIONE     */
/* ========================= */

const express = require("express");
const cors = require("cors");
const app = express();

// Permette al server di ricevere JSON nel body delle richieste
app.use(express.json());

// Permette richieste da frontend esterni (es. Vue)
app.use(cors());

// Necessario quando si è dietro proxy (come nel server del dipartimento)
app.enable("trust proxy");
app.use(express.static(__dirname));

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

app.get('/', async function (req, res) {
  var text = "Simoncino puzzone che non gioca a Remnant";
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



// import route
const itemRoutes = require("./routes/items");
//const configRoutes = require("./routes/config");

// usa le route
app.use("/items", itemRoutes);
//app.use("/config", configRoutes);



app.use(errorHandler); //simoncino puzza

module.exports = app;
