const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const organizationRoutes = require("./routes/organizations.routes");
const subjectRoutes = require("./routes/subjects.routes");
const namespaceRoutes = require("./routes/namespaces.routes");
const itemRoutes = require("./routes/itemsV2.routes");
const contentSpaceRoutes = require("./routes/contentSpaces.routes");
const editorialContextRoutes = require("./routes/editorialContexts.routes");
const venueRoutes = require("./routes/venues.routes");
const visitRoutes = require("./routes/visitsV2.routes");
const generatedVisitRoutes = require("./routes/generatedVisitsV2.routes");
const visitSessionRoutes = require("./routes/visitSessionsV2.routes");
const executionPreparationRoutes = require("./routes/executionPreparationsV2.routes");
const marketplaceRoutes = require("./routes/marketplaceV2.routes");
const navigatorRoutes = require("./routes/navigatorV2.routes");
const preferenceRoutes = require("./routes/preferences.routes");
const { loadCurrentUser } = require("./middlewares/auth");
const { configuredOrigins, requireTrustedOrigin } = require("./middlewares/originGuard");
const errorHandler = require("./middlewares/errorHandler");
const AppError = require("./utils/AppError");

const app = express();
const allowedOrigins = configuredOrigins();
app.enable("trust proxy");
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(requireTrustedOrigin);
app.use(loadCurrentUser);
app.get("/ping", (req, res) => res.json({ status: "ok", message: "ArtAround backend attivo", time: new Date() }));
app.get("/", (req, res) => res.json({
  name: "ArtAround",
  status: "ok",
  applications: { navigator: "/navigator/", marketplace: "/marketplace/" },
}));
app.use("/api", authRoutes);
app.use("/api", organizationRoutes);
app.use("/api", subjectRoutes);
app.use("/api", namespaceRoutes);
app.use("/api", itemRoutes);
app.use("/api", contentSpaceRoutes);
app.use("/api", editorialContextRoutes);
app.use("/api", venueRoutes);
app.use("/api", visitRoutes);
app.use("/api", generatedVisitRoutes);
app.use("/api", visitSessionRoutes);
app.use("/api", executionPreparationRoutes);
app.use("/api", marketplaceRoutes);
app.use("/api", navigatorRoutes);
app.use("/api", preferenceRoutes);

function mountBuiltSpa({ mountPath, distDir }) {
  const indexFile = path.join(distDir, "index.html");
  if (!fs.existsSync(indexFile)) return false;

  const exactMountPath = new RegExp(
    `^${mountPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
  );

  app.get(exactMountPath, (req, res) =>
    res.redirect(308, `${mountPath}/`)
  );

  app.use(mountPath, express.static(distDir, { index: false }));
  app.get(`${mountPath}/*`, (req, res) => res.sendFile(indexFile));

  return true;
}

const navigatorDist = path.join(__dirname, "clients", "navigator", "dist");
const marketplaceDist = path.join(__dirname, "clients", "marketplace", "dist");
if (fs.existsSync(path.join(navigatorDist, "navigator.config.json"))) {
  app.get("/navigator.config.json", (req, res) => res.sendFile(path.join(navigatorDist, "navigator.config.json")));
}
if (fs.existsSync(path.join(navigatorDist, "maps"))) {
  app.use("/maps", express.static(path.join(navigatorDist, "maps")));
}
mountBuiltSpa({ mountPath: "/navigator", distDir: navigatorDist });
mountBuiltSpa({ mountPath: "/marketplace", distDir: marketplaceDist });

app.use((req, res, next) => next(new AppError("Risorsa non trovata", 404)));
app.use(errorHandler);
module.exports = app;
