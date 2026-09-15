const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const NavigatorAsset = require("../models/navigatorAsset.model");
const Venue = require("../models/venue.model");
const AppError = require("../utils/AppError");
const { decodePayload } = require("./itemMediaUpload.service");
const { assertOrganizationPermission, hasOrganizationPermission } = require("./organizationAuthorization.service");

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_NAVIGATOR_ASSET_BYTES = 2 * 1024 * 1024;
const DEFAULT_THEME = Object.freeze({ primary: "#8D4050", accent: "#B78B52", surface: "#F6F1E8" });
const TRUSTED_MIME_BY_EXTENSION = Object.freeze({
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
});

function id(value) { return String(value?._id || value || ""); }
function repositoryNavigatorRoot() { return path.join(__dirname, "..", "clients", "navigator", "public"); }
function navigatorDistRoot() { return path.join(__dirname, "..", "clients", "navigator", "dist"); }
function configuredNavigatorConfigRoot() {
  return process.env.NAVIGATOR_CONFIG_DIR ? path.resolve(process.env.NAVIGATOR_CONFIG_DIR) : repositoryNavigatorRoot();
}
function navigatorConfigRoots() {
  return [
    ...(process.env.NAVIGATOR_CONFIG_DIR ? [path.resolve(process.env.NAVIGATOR_CONFIG_DIR)] : []),
    repositoryNavigatorRoot(),
    navigatorDistRoot(),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
}
function configRelativePath(venueId) { return path.join("navigator-configs", String(venueId), "navigator.config.json"); }
function assetUrl(assetId) { return `/api/navigator-assets/${encodeURIComponent(String(assetId))}`; }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim().length > 0; }
function isObjectId(value) { return OBJECT_ID.test(String(value || "")) && !/^0{24}$/i.test(String(value || "")); }

async function readJsonFile(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new AppError("Configurazione Navigator non valida: JSON malformato", 400);
    throw error;
  }
}

async function findConfigEntry(venueId) {
  for (const root of navigatorConfigRoots()) {
    const filePath = path.join(root, configRelativePath(venueId));
    const config = await readJsonFile(filePath);
    if (config) return { config, filePath, directory: path.dirname(filePath), root };
  }
  return null;
}

async function platformBrandingDefaults() {
  for (const root of navigatorConfigRoots()) {
    const config = await readJsonFile(path.join(root, "navigator-platform", "navigator.config.json"));
    if (config?.schemaVersion === 1 && isRecord(config.branding)) {
      return {
        productTitle: isText(config.branding.productTitle) ? config.branding.productTitle.trim() : "ArtAround",
        theme: isRecord(config.branding.theme) ? config.branding.theme : DEFAULT_THEME,
      };
    }
  }
  return { productTitle: "ArtAround", theme: DEFAULT_THEME };
}

async function defaultConfigForVenue(venue) {
  const platform = await platformBrandingDefaults();
  return {
    schemaVersion: 3,
    venueId: id(venue),
    branding: {
      productTitle: platform.productTitle,
      museumTitle: venue.name,
      subtitle: "",
      theme: {
        primary: HEX_COLOR.test(String(platform.theme?.primary || "")) ? platform.theme.primary : DEFAULT_THEME.primary,
        accent: HEX_COLOR.test(String(platform.theme?.accent || "")) ? platform.theme.accent : DEFAULT_THEME.accent,
        surface: HEX_COLOR.test(String(platform.theme?.surface || "")) ? platform.theme.surface : DEFAULT_THEME.surface,
      },
    },
  };
}

async function venueFor({ venueId, userId = null, permissionCode = null }) {
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" }).lean();
  if (!venue) throw new AppError("Sede non trovata", 404);
  if (userId && permissionCode) {
    await assertOrganizationPermission({ userId, organizationId: venue.ownerOrganizationId, permissionCode });
  }
  return venue;
}

function validateAssetRef(value, field) {
  if (value === undefined || value === null) return;
  if (!isRecord(value) || !isObjectId(value.assetId) || (value.alt !== undefined && typeof value.alt !== "string")) {
    throw new AppError("Configurazione Navigator non valida", 400, [{ field, code: "INVALID_NAVIGATOR_ASSET_REF" }]);
  }
}

function validateV3Shape(config, expectedVenueId) {
  if (!isRecord(config) || config.schemaVersion !== 3 || String(config.venueId || "") !== String(expectedVenueId || "")) {
    throw new AppError("Configurazione Navigator v3 non valida", 400, [{ field: "venueId", code: "INVALID_NAVIGATOR_CONFIG" }]);
  }
  const branding = config.branding;
  if (!isRecord(branding) || !isText(branding.productTitle) || !isText(branding.museumTitle)) {
    throw new AppError("Titolo prodotto e museo sono obbligatori", 400, [{ field: "branding", code: "INVALID_NAVIGATOR_BRANDING" }]);
  }
  if (branding.subtitle !== undefined && typeof branding.subtitle !== "string") {
    throw new AppError("Il sottotitolo deve essere una stringa", 400, [{ field: "branding.subtitle", code: "INVALID_NAVIGATOR_SUBTITLE" }]);
  }
  validateAssetRef(branding.logo, "branding.logo");
  validateAssetRef(branding.heroImage, "branding.heroImage");
  if (!isRecord(branding.theme)) throw new AppError("Tema Navigator mancante", 400, [{ field: "branding.theme", code: "INVALID_NAVIGATOR_THEME" }]);
  for (const token of ["primary", "accent", "surface"]) {
    if (!HEX_COLOR.test(String(branding.theme[token] || ""))) {
      throw new AppError("Colore Navigator non valido", 400, [{ field: `branding.theme.${token}`, code: "INVALID_NAVIGATOR_COLOR" }]);
    }
  }
  return config;
}

async function assertAssetOwnership({ assetId, organizationId }) {
  const asset = await NavigatorAsset.findOne({ _id: assetId, organizationId }).select("_id").lean();
  if (!asset) throw new AppError("Asset Navigator non disponibile per questa organizzazione", 400, [{ field: "assetId", code: "NAVIGATOR_ASSET_NOT_AVAILABLE" }]);
}

function deterministicLegacyAssetId({ venueId, role, data }) {
  const contentHash = crypto.createHash("sha256").update(data).digest("hex");
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha1").update(`navigator-config-v3:${venueId}:${role}:${contentHash}`).digest("hex").slice(0, 24),
  );
}

async function importLegacyAsset({ venue, role, value, configEntry }) {
  if (!value) return undefined;
  if (value.assetId) return { assetId: String(value.assetId), alt: String(value.alt || "") };
  const src = String(value.src || "");
  if (!src.startsWith("/navigator-assets/") || src.includes("\\") || src.includes("..") || src.includes("//")) {
    throw new AppError("Riferimento asset legacy non valido", 400, [{ field: `branding.${role}.src`, code: "INVALID_LEGACY_NAVIGATOR_ASSET" }]);
  }
  if (!configEntry?.directory) throw new AppError("L'asset legacy non può essere importato senza il pacchetto sorgente", 400);
  const assetRoot = path.resolve(configEntry.directory, "navigator-assets");
  const assetPath = path.resolve(configEntry.directory, src.slice(1));
  if (!assetPath.startsWith(assetRoot + path.sep)) throw new AppError("Percorso asset Navigator non sicuro", 400);
  let data;
  try { data = await fs.readFile(assetPath); }
  catch (error) {
    if (error?.code === "ENOENT") throw new AppError(`Asset Navigator legacy mancante: ${src}`, 400);
    throw error;
  }
  const mimeType = TRUSTED_MIME_BY_EXTENSION[path.extname(assetPath).toLowerCase()];
  if (!mimeType) throw new AppError("Formato asset Navigator legacy non supportato", 400);
  const assetId = deterministicLegacyAssetId({ venueId: id(venue), role, data });
  await NavigatorAsset.updateOne(
    { _id: assetId },
    { $set: {
      organizationId: venue.ownerOrganizationId,
      mimeType,
      fileName: path.basename(assetPath),
      byteLength: data.length,
      data,
      createdBy: venue.createdBy,
    } },
    { upsert: true },
  );
  return { assetId: String(assetId), alt: String(value.alt || "") };
}

async function toV3Config({ venue, document, configEntry }) {
  const base = document || await defaultConfigForVenue(venue);
  if (base.schemaVersion === 3) {
    const config = { ...base, venueId: id(venue) };
    validateV3Shape(config, id(venue));
    return config;
  }
  if (base.schemaVersion !== 2 || String(base.venueId || "") !== id(venue) || !isRecord(base.branding)) {
    throw new AppError("Configurazione Navigator legacy non valida", 400);
  }
  const logo = await importLegacyAsset({ venue, role: "logo", value: base.branding.logo, configEntry });
  const heroImage = await importLegacyAsset({ venue, role: "heroImage", value: base.branding.heroImage, configEntry });
  return validateV3Shape({
    schemaVersion: 3,
    venueId: id(venue),
    branding: {
      productTitle: base.branding.productTitle,
      museumTitle: base.branding.museumTitle,
      subtitle: base.branding.subtitle || "",
      ...(logo ? { logo } : {}),
      ...(heroImage ? { heroImage } : {}),
      theme: base.branding.theme,
    },
  }, id(venue));
}

async function validateReferencedAssets(config, venue) {
  for (const key of ["logo", "heroImage"]) {
    const ref = config.branding?.[key];
    if (ref?.assetId) await assertAssetOwnership({ assetId: ref.assetId, organizationId: venue.ownerOrganizationId });
  }
}

async function writeConfig(config) {
  const root = configuredNavigatorConfigRoot();
  const filePath = path.join(root, configRelativePath(config.venueId));
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (["EACCES", "EROFS", "EPERM"].includes(error?.code)) {
      throw new AppError("La directory delle configurazioni Navigator non è scrivibile", 500, [{ code: "NAVIGATOR_CONFIG_DIR_NOT_WRITABLE" }]);
    }
    throw error;
  }
  return filePath;
}

async function getVenueNavigatorConfig({ venueId, actorUserId }) {
  const venue = await venueFor({ venueId, userId: actorUserId, permissionCode: "venue.view" });
  const entry = await findConfigEntry(venueId);
  const config = entry?.config || await defaultConfigForVenue(venue);
  const canManage = await hasOrganizationPermission({ userId: actorUserId, organizationId: venue.ownerOrganizationId, permissionCode: "venue.profile.manage" });
  const sources = await Venue.find({ ownerOrganizationId: venue.ownerOrganizationId, lifecycleStatus: "active", _id: { $ne: venue._id } })
    .select("name")
    .sort({ name: 1, _id: 1 })
    .lean();
  return {
    exists: Boolean(entry),
    legacy: config.schemaVersion === 2,
    canManage,
    config,
    copySources: sources.map((source) => ({ id: id(source), name: source.name })),
  };
}

async function updateVenueNavigatorConfig({ venueId, actorUserId, payload }) {
  const venue = await venueFor({ venueId, userId: actorUserId, permissionCode: "venue.profile.manage" });
  const entry = await findConfigEntry(venueId);
  const current = entry?.config || await defaultConfigForVenue(venue);
  const currentV3 = await toV3Config({ venue, document: current, configEntry: entry });
  const requested = isRecord(payload?.config) ? payload.config : payload;
  const requestedBranding = isRecord(requested?.branding) ? requested.branding : requested;
  const branding = isRecord(requestedBranding) ? requestedBranding : currentV3.branding;
  const candidate = {
    schemaVersion: 3,
    venueId: id(venue),
    branding: {
      productTitle: String(branding.productTitle ?? currentV3.branding.productTitle).trim(),
      museumTitle: String(branding.museumTitle ?? currentV3.branding.museumTitle).trim(),
      subtitle: String(branding.subtitle ?? currentV3.branding.subtitle ?? ""),
      ...(branding.logo === null ? {} : (branding.logo || currentV3.branding.logo) ? { logo: branding.logo || currentV3.branding.logo } : {}),
      ...(branding.heroImage === null ? {} : (branding.heroImage || currentV3.branding.heroImage) ? { heroImage: branding.heroImage || currentV3.branding.heroImage } : {}),
      theme: {
        primary: String(branding.theme?.primary ?? currentV3.branding.theme.primary),
        accent: String(branding.theme?.accent ?? currentV3.branding.theme.accent),
        surface: String(branding.theme?.surface ?? currentV3.branding.theme.surface),
      },
    },
  };
  validateV3Shape(candidate, id(venue));
  await validateReferencedAssets(candidate, venue);
  await writeConfig(candidate);
  return candidate;
}

async function uploadVenueNavigatorAsset({ venueId, actorUserId, payload }) {
  const venue = await venueFor({ venueId, userId: actorUserId, permissionCode: "venue.profile.manage" });
  const { buffer, mimeType, extension } = decodePayload(payload, {
    maxBytes: MAX_NAVIGATOR_ASSET_BYTES,
    maxBytesMessage: "Scegli un'immagine di massimo 2 MB",
  });
  const originalName = String(payload?.fileName || "").trim().slice(0, 255);
  const asset = await NavigatorAsset.create({
    organizationId: venue.ownerOrganizationId,
    mimeType,
    fileName: originalName || `navigator-${Date.now()}.${extension}`,
    byteLength: buffer.length,
    data: buffer,
    createdBy: actorUserId,
  });
  return { id: id(asset), mimeType, fileName: asset.fileName, byteLength: asset.byteLength, url: assetUrl(asset._id) };
}

async function copyVenueNavigatorConfig({ venueId, sourceVenueId, actorUserId }) {
  const target = await venueFor({ venueId, userId: actorUserId, permissionCode: "venue.profile.manage" });
  const source = await Venue.findOne({ _id: sourceVenueId, lifecycleStatus: "active" }).lean();
  if (!source) throw new AppError("Sede sorgente non trovata", 404);
  if (id(source.ownerOrganizationId) !== id(target.ownerOrganizationId)) {
    throw new AppError("Puoi copiare la configurazione solo tra sedi della stessa organizzazione", 403);
  }
  const sourceEntry = await findConfigEntry(sourceVenueId);
  if (!sourceEntry) throw new AppError("La sede sorgente non ha una configurazione Navigator", 400);
  const sourceV3 = await toV3Config({ venue: source, document: sourceEntry.config, configEntry: sourceEntry });
  await validateReferencedAssets(sourceV3, source);
  if (sourceEntry.config.schemaVersion !== 3) await writeConfig(sourceV3);
  const targetConfig = { ...sourceV3, venueId: id(target), branding: { ...sourceV3.branding } };
  await writeConfig(targetConfig);
  return targetConfig;
}

async function getNavigatorAsset(assetIdValue) {
  if (!isObjectId(assetIdValue)) throw new AppError("Asset Navigator non valido", 400);
  const asset = await NavigatorAsset.findById(assetIdValue).select("+data").lean();
  if (!asset) throw new AppError("Asset Navigator non trovato", 404);
  return asset;
}

async function migrateLegacyVenueConfig({ venueId }) {
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" }).lean();
  if (!venue) return { venueId: String(venueId), status: "venue_missing" };
  const entry = await findConfigEntry(venueId);
  if (!entry) return { venueId: String(venueId), status: "config_missing" };
  if (entry.config.schemaVersion === 3) return { venueId: String(venueId), status: "already_v3" };
  const config = await toV3Config({ venue, document: entry.config, configEntry: entry });
  await validateReferencedAssets(config, venue);
  await writeConfig(config);
  return { venueId: String(venueId), status: "migrated" };
}

async function migrateAllLegacyNavigatorConfigs() {
  const root = configuredNavigatorConfigRoot();
  const directory = path.join(root, "navigator-configs");
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isObjectId(entry.name)) continue;
    results.push(await migrateLegacyVenueConfig({ venueId: entry.name }));
  }
  return results;
}

module.exports = {
  MAX_NAVIGATOR_ASSET_BYTES,
  configuredNavigatorConfigRoot,
  getVenueNavigatorConfig,
  updateVenueNavigatorConfig,
  uploadVenueNavigatorAsset,
  copyVenueNavigatorConfig,
  getNavigatorAsset,
  migrateLegacyVenueConfig,
  migrateAllLegacyNavigatorConfigs,
};
