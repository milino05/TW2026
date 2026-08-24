import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const clientDirectory = resolve(scriptDirectory, "..");
const directories = process.argv.slice(2).length ? process.argv.slice(2) : ["public"];
const hexColor = /^#[0-9a-f]{6}$/i;
const objectId = /^[0-9a-f]{24}$/i;
const failures = [];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveDirectory(input) {
  return isAbsolute(input) ? resolve(input) : resolve(clientDirectory, input);
}

function fail(configPath, message) {
  failures.push(configPath + ": " + message);
}

function checkAsset(configPath, rootDirectory, label, value) {
  if (value === undefined) return;
  if (!isRecord(value) || !isText(value.src) || typeof value.alt !== "string") {
    fail(configPath, label + " deve contenere src e alt");
    return;
  }
  if (!value.src.startsWith("/navigator-assets/") || value.src.includes("\\") || value.src.includes("..") || value.src.includes("//")) {
    fail(configPath, label + ".src deve essere un percorso sicuro sotto /navigator-assets/");
    return;
  }
  const assetPath = resolve(rootDirectory, value.src.slice(1));
  const assetRoot = resolve(rootDirectory, "navigator-assets");
  if (!assetPath.startsWith(assetRoot + "/") || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    fail(configPath, label + ".src non trova il file " + value.src);
  }
}

for (const input of directories) {
  const rootDirectory = resolveDirectory(input);
  const configPath = join(rootDirectory, "navigator.config.json");
  if (!existsSync(configPath)) {
    fail(configPath, "file mancante");
    continue;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    fail(configPath, "JSON non valido: " + error.message);
    continue;
  }

  if (!isRecord(config) || ![1, 2].includes(config.schemaVersion)) {
    fail(configPath, "schemaVersion deve essere 1 per la piattaforma o 2 per un museo");
  }
  if (config?.schemaVersion === 2 && (!objectId.test(String(config.venueId || "")) || /^0{24}$/.test(String(config.venueId || "")))) {
    fail(configPath, "venueId deve essere un ObjectId MongoDB non nullo");
  }

  const branding = config?.branding;
  if (!isRecord(branding)) {
    fail(configPath, "branding deve essere un oggetto");
    continue;
  }
  if (!isText(branding.productTitle)) fail(configPath, "branding.productTitle è obbligatorio");
  if (!isText(branding.museumTitle)) fail(configPath, "branding.museumTitle è obbligatorio");
  if (branding.subtitle !== undefined && typeof branding.subtitle !== "string") fail(configPath, "branding.subtitle deve essere una stringa");
  checkAsset(configPath, rootDirectory, "branding.logo", branding.logo);
  checkAsset(configPath, rootDirectory, "branding.heroImage", branding.heroImage);

  if (!isRecord(branding.theme)) {
    fail(configPath, "branding.theme deve essere un oggetto");
  } else {
    for (const token of ["primary", "accent", "surface"]) {
      if (typeof branding.theme[token] !== "string" || !hexColor.test(branding.theme[token])) {
        fail(configPath, "branding.theme." + token + " deve usare il formato #RRGGBB");
      }
    }
  }
}

if (failures.length) {
  console.error("Navigator config check fallito:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("Navigator config check superato (" + directories.length + " configurazioni).");
