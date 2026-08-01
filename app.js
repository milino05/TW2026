const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const museumRoutes = require("./routes/museums.routes");
const itemRoutes = require("./routes/items.routes");
const visitRoutes = require("./routes/visits.routes");
const { loadCurrentUser } = require("./middlewares/auth");
const { configuredOrigins, requireTrustedOrigin } = require("./middlewares/originGuard");
const errorHandler = require("./middlewares/errorHandler");
const AppError = require("./utils/AppError");

const app = express();
const allowedOrigins = configuredOrigins();

app.enable("trust proxy");
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Le richieste same-origin non hanno bisogno di header CORS. Per le altre
      // origini l'assenza dell'header impedisce al browser di leggere la risposta.
      return callback(null, false);
    },
  }),
);

app.use(requireTrustedOrigin);
app.use(loadCurrentUser);
app.use(express.static(path.join(__dirname, "public")));

app.get("/ping", (req, res) => {
  res.json({
    status: "ok",
    message: "ArtAround backend attivo",
    time: new Date(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "ArtAround API",
    status: "ok",
  });
});

app.use("/api", authRoutes);
app.use("/api", museumRoutes);
app.use("/api", itemRoutes);
app.use("/api", visitRoutes);

app.use((req, res, next) => {
  next(new AppError("Risorsa non trovata", 404));
});

app.use(errorHandler);

module.exports = app;
