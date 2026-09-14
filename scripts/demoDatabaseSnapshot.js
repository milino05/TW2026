const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");

const { configuredMediaRoot } = require("../services/itemMediaUpload.service");
const { configuredFloorPlanRoot } = require("../services/venueFloorPlanUpload.service");
const { configuredRecognitionMediaRoot } = require("../services/venueRecognitionMediaUpload.service");

const SNAPSHOT_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const DOCUMENTS_DIRECTORY = "collections";
const ASSETS_DIRECTORY = "assets";
const AUTH_SESSION_COLLECTION = "sessions";
const DEFAULT_FIXTURE_ROOT = process.env.DEMO_DATABASE_FIXTURE_DIR
  ? path.resolve(process.env.DEMO_DATABASE_FIXTURE_DIR)
  : path.join(__dirname, "fixtures", "demo-database");

function ejson() {
  const api = mongoose.mongo?.BSON?.EJSON;
  if (!api) throw new Error("MongoDB EJSON non disponibile tramite il driver Mongoose");
  return api;
}

function encodeDocument(document) {
  return ejson().stringify(document, { relaxed: false });
}

function decodeDocument(serialized) {
  return ejson().parse(serialized, { relaxed: false });
}

function encodeManifest(manifest) {
  return ejson().stringify(manifest, { relaxed: true });
}

function decodeManifest(serialized) {
  return ejson().parse(serialized, { relaxed: true });
}

function collectionFileName(name) {
  return `${Buffer.from(String(name), "utf8").toString("base64url")}.ndjson`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function clearDirectory(root) {
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(entries.map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true })));
}

async function walkFiles(root, relativeDirectory = "") {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Asset non regolare non supportato nella snapshot: ${relativePath}`);
  }
  return files;
}

function safeRelativePath(value) {
  const normalized = path.normalize(String(value || ""));
  if (!normalized || path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Percorso fixture non valido: ${value}`);
  }
  return normalized;
}

async function snapshotAssetTree({ sourceRoot, fixtureRoot }) {
  await clearDirectory(fixtureRoot);
  const sourceFiles = await walkFiles(sourceRoot);
  const files = [];
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(fixtureRoot, relativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
    const stat = await fs.stat(destinationPath);
    files.push({
      path: relativePath.split(path.sep).join("/"),
      size: stat.size,
      sha256: await sha256File(destinationPath),
    });
  }
  return files;
}

async function restoreAssetTree({ fixtureRoot, destinationRoot, files = [] }) {
  await clearDirectory(destinationRoot);
  for (const entry of files) {
    const relativePath = safeRelativePath(entry.path);
    const sourcePath = path.join(fixtureRoot, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

function uploadRoots() {
  return {
    "item-media": configuredMediaRoot(),
    "venue-floor-plans": configuredFloorPlanRoot(),
    "venue-recognition-media": configuredRecognitionMediaRoot(),
  };
}

function recreatableIndexKey(index) {
  if (index?.weights && index?.key?._fts === "text") {
    return Object.fromEntries(Object.keys(index.weights).map((field) => [field, "text"]));
  }
  return index.key;
}

function recreatableIndexOptions(index) {
  const keys = [
    "name",
    "unique",
    "sparse",
    "expireAfterSeconds",
    "partialFilterExpression",
    "collation",
    "hidden",
    "weights",
    "default_language",
    "language_override",
    "wildcardProjection",
    "bits",
    "min",
    "max",
    "bucketSize",
  ];
  return Object.fromEntries(keys.filter((key) => index[key] !== undefined).map((key) => [key, index[key]]));
}

async function exportCollection({ db, info, collectionsRoot }) {
  const collection = db.collection(info.name);
  const file = collectionFileName(info.name);
  const filePath = path.join(collectionsRoot, file);
  const includeDocuments = info.name !== AUTH_SESSION_COLLECTION;
  const documents = includeDocuments
    ? await collection.find({}).sort({ _id: 1 }).toArray()
    : [];
  const serialized = documents.map((document) => encodeDocument(document)).join("\n");
  await fs.writeFile(filePath, serialized ? `${serialized}\n` : "", "utf8");
  const indexes = await collection.indexes();
  return {
    name: info.name,
    file,
    documentCount: documents.length,
    documentsIncluded: includeDocuments,
    redactionReason: includeDocuments ? null : "Authentication sessions are runtime credentials and are not seed data.",
    sha256: await sha256File(filePath),
    options: info.options || {},
    indexes,
  };
}

async function exportDemoDatabaseSnapshot({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  db = mongoose.connection.db,
  assetRoots = uploadRoots(),
} = {}) {
  if (!db) throw new Error("Connessione MongoDB non disponibile");
  await clearDirectory(fixtureRoot);
  const collectionsRoot = path.join(fixtureRoot, DOCUMENTS_DIRECTORY);
  const assetsRoot = path.join(fixtureRoot, ASSETS_DIRECTORY);
  await fs.mkdir(collectionsRoot, { recursive: true });
  await fs.mkdir(assetsRoot, { recursive: true });

  const collectionInfos = (await db.listCollections({}, { nameOnly: false }).toArray())
    .filter((entry) => !String(entry.name || "").startsWith("system."))
    .sort((left, right) => left.name.localeCompare(right.name));
  const collections = [];
  const views = [];
  for (const info of collectionInfos) {
    if (info.type === "view") {
      views.push({ name: info.name, options: info.options || {} });
      continue;
    }
    if (!["collection", "timeseries"].includes(info.type)) {
      throw new Error(`Tipo MongoDB non supportato nella snapshot: ${info.type} (${info.name})`);
    }
    collections.push(await exportCollection({ db, info, collectionsRoot }));
  }

  const assets = {};
  for (const [name, sourceRoot] of Object.entries(assetRoots)) {
    assets[name] = await snapshotAssetTree({ sourceRoot, fixtureRoot: path.join(assetsRoot, name) });
  }

  const manifest = {
    version: SNAPSHOT_VERSION,
    sourceDatabase: db.databaseName,
    collections,
    views,
    assets,
  };
  await fs.writeFile(path.join(fixtureRoot, MANIFEST_FILE), `${encodeManifest(manifest)}\n`, "utf8");
  return {
    fixtureRoot,
    collections: collections.length,
    documents: collections.reduce((sum, entry) => sum + entry.documentCount, 0),
    assetFiles: Object.values(assets).reduce((sum, entries) => sum + entries.length, 0),
    excludedRuntimeDocuments: collections
      .filter((entry) => !entry.documentsIncluded)
      .map((entry) => entry.name),
  };
}

async function loadDemoDatabaseSnapshot({ fixtureRoot = DEFAULT_FIXTURE_ROOT, required = false } = {}) {
  const manifestPath = path.join(fixtureRoot, MANIFEST_FILE);
  try {
    const manifest = decodeManifest(await fs.readFile(manifestPath, "utf8"));
    if (manifest.version !== SNAPSHOT_VERSION) throw new Error(`Versione snapshot database non supportata: ${manifest.version}`);
    if (!Array.isArray(manifest.collections) || !manifest.assets) throw new Error("Manifest snapshot database incompleto");
    return manifest;
  } catch (error) {
    if (error?.code === "ENOENT" && !required) return null;
    throw error;
  }
}

async function hasDemoDatabaseSnapshot({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  return exists(path.join(fixtureRoot, MANIFEST_FILE));
}

async function validateSnapshotFiles({ fixtureRoot, manifest }) {
  for (const entry of manifest.collections) {
    const filePath = path.join(fixtureRoot, DOCUMENTS_DIRECTORY, safeRelativePath(entry.file));
    const actualHash = await sha256File(filePath);
    if (actualHash !== entry.sha256) throw new Error(`Checksum collection non valido: ${entry.name}`);
  }
  for (const [assetGroup, entries] of Object.entries(manifest.assets || {})) {
    const groupRoot = path.join(fixtureRoot, ASSETS_DIRECTORY, assetGroup);
    for (const entry of entries) {
      const relativePath = safeRelativePath(entry.path);
      const filePath = path.join(groupRoot, relativePath);
      const stat = await fs.stat(filePath);
      if (stat.size !== entry.size) throw new Error(`Dimensione asset non valida: ${assetGroup}/${entry.path}`);
      const actualHash = await sha256File(filePath);
      if (actualHash !== entry.sha256) throw new Error(`Checksum asset non valido: ${assetGroup}/${entry.path}`);
    }
  }
}

async function dropCurrentDatabaseObjects(db) {
  const infos = (await db.listCollections({}, { nameOnly: false }).toArray())
    .filter((entry) => !String(entry.name || "").startsWith("system."))
    .sort((left, right) => Number(right.type === "view") - Number(left.type === "view"));
  for (const info of infos) {
    try {
      await db.dropCollection(info.name);
    } catch (error) {
      if (error?.codeName !== "NamespaceNotFound") throw error;
    }
  }
}

async function restoreCollectionDocuments({ db, fixtureRoot, entry }) {
  const filePath = path.join(fixtureRoot, DOCUMENTS_DIRECTORY, safeRelativePath(entry.file));
  const text = await fs.readFile(filePath, "utf8");
  const documents = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => decodeDocument(line));
  if (documents.length !== entry.documentCount) {
    throw new Error(`Conteggio documenti non valido per ${entry.name}: ${documents.length} != ${entry.documentCount}`);
  }
  if (documents.length) await db.collection(entry.name).insertMany(documents, { ordered: true });
}

async function restoreCollectionIndexes({ db, entry }) {
  const collection = db.collection(entry.name);
  for (const index of entry.indexes || []) {
    if (index.name === "_id_") continue;
    await collection.createIndex(recreatableIndexKey(index), recreatableIndexOptions(index));
  }
}

async function restoreDemoDatabaseSnapshot({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  db = mongoose.connection.db,
  assetRoots = uploadRoots(),
} = {}) {
  if (!db) throw new Error("Connessione MongoDB non disponibile");
  const manifest = await loadDemoDatabaseSnapshot({ fixtureRoot, required: true });
  await validateSnapshotFiles({ fixtureRoot, manifest });

  await dropCurrentDatabaseObjects(db);
  for (const entry of manifest.collections) {
    await db.createCollection(entry.name, entry.options || {});
    await restoreCollectionDocuments({ db, fixtureRoot, entry });
  }
  for (const entry of manifest.collections) await restoreCollectionIndexes({ db, entry });
  for (const view of manifest.views || []) await db.createCollection(view.name, view.options || {});

  for (const [name, destinationRoot] of Object.entries(assetRoots)) {
    const files = manifest.assets[name] || [];
    await restoreAssetTree({
      fixtureRoot: path.join(fixtureRoot, ASSETS_DIRECTORY, name),
      destinationRoot,
      files,
    });
  }

  return {
    collections: manifest.collections.length,
    documents: manifest.collections.reduce((sum, entry) => sum + entry.documentCount, 0),
    assetFiles: Object.values(manifest.assets).reduce((sum, entries) => sum + entries.length, 0),
  };
}

module.exports = {
  SNAPSHOT_VERSION,
  AUTH_SESSION_COLLECTION,
  DEFAULT_FIXTURE_ROOT,
  encodeDocument,
  decodeDocument,
  snapshotAssetTree,
  restoreAssetTree,
  exportDemoDatabaseSnapshot,
  loadDemoDatabaseSnapshot,
  hasDemoDatabaseSnapshot,
  restoreDemoDatabaseSnapshot,
};
