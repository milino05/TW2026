/*
  ArtAround Backend - Minimal API Server
  Compatibile con deploy dipartimento
*/
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const mongoose = require("mongoose");
const http = require("http");
require("./config/mongoUnitOfWork");
const { ensureDatabaseSchemaReadiness } = require("./services/databaseSchemaReadiness.service");

const mongoURI = process.env.MONGO_URI;
const PORT = process.env.PORT || 8000;

if (!mongoURI) {
  console.error("MONGO_URI mancante. Controlla il file .env sul server.");
  process.exit(1);
}

async function startServer() {
  try {
    await mongoose.connect(mongoURI);
    console.log("Connessione a MongoDB riuscita");

    const schemaReadiness = await ensureDatabaseSchemaReadiness();
    if (schemaReadiness.venueTargetPublicCodeIndex?.changed) {
      console.log("Schema MongoDB riallineato: indice VenueTarget.publicCode aggiornato");
    }
    if (schemaReadiness.sessionPlanOwnerShape?.changed) {
      console.log(`Schema MongoDB riallineato: ${schemaReadiness.sessionPlanOwnerShape.migratedDocuments} SessionPlan migrati all'owner tipizzato`);
    }

    // Carichiamo l'app soltanto dopo il controllo degli indici legacy, così i
    // model Mongoose vedono uno schema Mongo già coerente con il dominio attuale.
    const app = require("./app");
    const server = http.createServer(app);
    require("./services/synchronizedVisitRealtime.service").initializeSynchronizedVisitRealtime(server);
    server.listen(PORT, () => {
      console.log(`Server avviato su porta ${PORT}`);
    });
  } catch (err) {
    console.error("Errore connessione MongoDB:", err);
    process.exit(1);
  }
}

startServer();
