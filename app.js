const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const organizationRoutes = require("./routes/organizations.routes");
const subjectRoutes = require("./routes/subjects.routes");
const semanticResolverRoutes = require("./routes/semanticResolver.routes");
const namespaceRoutes = require("./routes/namespaces.routes");
const physicalVocabularyRoutes = require("./routes/physicalVocabularies.routes");
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
const { configuredMediaRoot } = require("./services/itemMediaUpload.service");
const { configuredFloorPlanRoot } = require("./services/venueFloorPlanUpload.service");
const { loadCurrentUser } = require("./middlewares/auth");
const { configuredOrigins, requireTrustedOrigin } = require("./middlewares/originGuard");
const errorHandler = require("./middlewares/errorHandler");
const AppError = require("./utils/AppError");

const app = express();
const allowedOrigins = configuredOrigins();
app.enable("trust proxy");
app.use(express.json({ limit: "6mb" }));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(requireTrustedOrigin);
app.use(loadCurrentUser);
app.use("/uploads/item-media", express.static(configuredMediaRoot(), {
  immutable: true,
  maxAge: "30d",
  fallthrough: false,
  setHeaders(response) { response.setHeader("X-Content-Type-Options", "nosniff"); },
}));
app.use("/uploads/venue-floor-plans", express.static(configuredFloorPlanRoot(), {
  immutable: true,
  maxAge: "30d",
  fallthrough: false,
  setHeaders(response) { response.setHeader("X-Content-Type-Options", "nosniff"); },
}));
app.get("/ping", (req, res) => res.json({ status: "ok", message: "ArtAround backend attivo", time: new Date() }));
app.get("/", (req, res) => res.json({
  name: "ArtAround",
  status: "ok",
  applications: { navigator: "/navigator/", marketplace: "/marketplace/" },
}));
app.use("/api", authRoutes);
app.use("/api", organizationRoutes);
app.use("/api", subjectRoutes);
app.use("/api", semanticResolverRoutes);
app.use("/api", namespaceRoutes);
app.use("/api", physicalVocabularyRoutes);
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
const externalNavigatorConfigRoot = process.env.NAVIGATOR_CONFIG_DIR
  ? path.resolve(process.env.NAVIGATOR_CONFIG_DIR)
  : null;
const navigatorConfigRoots = [
  ...(externalNavigatorConfigRoot ? [externalNavigatorConfigRoot] : []),
  navigatorDist,
].filter((entry, index, entries) => entries.indexOf(entry) === index);

function firstNavigatorFile(relativePath) {
  return navigatorConfigRoots
    .map((root) => path.join(root, relativePath))
    .find((candidate) => fs.existsSync(candidate)) || null;
}

function serveNavigatorConfig(relativePath) {
  return (req, res, next) => {
    const configFile = firstNavigatorFile(relativePath);
    if (!configFile) return next();
    res.set("Cache-Control", "no-store");
    return res.sendFile(configFile);
  };
}

app.get("/navigator-platform/navigator.config.json", serveNavigatorConfig(
  path.join("navigator-platform", "navigator.config.json"),
));
app.get("/navigator-configs/:venueId/navigator.config.json", (req, res, next) => {
  const venueId = String(req.params.venueId || "");
  if (!/^[0-9a-f]{24}$/i.test(venueId)) return next();
  return serveNavigatorConfig(path.join("navigator-configs", venueId, "navigator.config.json"))(req, res, next);
});

// Compatibilità con il precedente deploy a configurazione singola.
app.get("/navigator.config.json", serveNavigatorConfig("navigator.config.json"));

for (const root of navigatorConfigRoots) {
  const platformDirectory = path.join(root, "navigator-platform");
  const museumsDirectory = path.join(root, "navigator-configs");
  const legacyAssetsDirectory = path.join(root, "navigator-assets");
  if (fs.existsSync(platformDirectory)) {
    app.use("/navigator-platform", express.static(platformDirectory, { immutable: true, maxAge: "1h" }));
  }
  if (fs.existsSync(museumsDirectory)) {
    app.use("/navigator-configs", express.static(museumsDirectory, { immutable: true, maxAge: "1h" }));
  }
  if (fs.existsSync(legacyAssetsDirectory)) {
    app.use("/navigator-assets", express.static(legacyAssetsDirectory, { immutable: true, maxAge: "1h" }));
  }
}
if (fs.existsSync(path.join(navigatorDist, "maps"))) {
  app.use("/maps", express.static(path.join(navigatorDist, "maps")));
}
mountBuiltSpa({ mountPath: "/navigator", distDir: navigatorDist });
mountBuiltSpa({ mountPath: "/marketplace", distDir: marketplaceDist });

app.use((req, res, next) => next(new AppError("Risorsa non trovata", 404)));
app.use(errorHandler);
module.exports = app;