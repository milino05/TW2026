const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/app-shell.js"), "utf8");
const router = fs.readFileSync(path.join(root, "clients/marketplace/src/application/router.js"), "utf8");
const hub = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/create-hub-view.js"), "utf8");
const itemEditor = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/item-authoring-view.js"), "utf8");
const venueChooser = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/venue-target-chooser.js"), "utf8");
const workspaceBrowser = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/workspace-browser-view.js"), "utf8");

test("shell espone le cinque aree principali e monta il create hub", () => {
  assert.match(router, /"\/create"/);
  assert.match(shell, /import "\.\/create-hub-view\.js"/);
  assert.match(shell, /route === "\/create" \? "<artaround-create-hub-view><\/artaround-create-hub-view>"/);
  for (const label of ["Catalogo", "Le mie risorse", "Crea", "Licenze e vendite", "Account e organizzazioni"]) assert.match(shell, new RegExp(`>${label}<`));
  assert.doesNotMatch(shell, /<span>Crea contenuto<\/span>/);
  assert.doesNotMatch(shell, /<span>Crea visita<\/span>/);
});

test("create hub usa il preflight e blocca entrambi i flussi contenuto quando mancano le regole", () => {
  assert.match(hub, /marketplaceRepository\.authoringPreflight\(/);
  assert.match(hub, /if \(!content\?\.allowed\) return this\.blockerCard\(\)/);
  assert.match(hub, /if \(!this\.preflight\?\.content\?\.allowed\) return this\.blockerCard\(\{ physical: true \}\)/);
  assert.match(hub, /Prima prepara le regole editoriali/);
  assert.match(hub, /Non verrà creato alcun contenuto finché questo prerequisito non è risolto/);
  assert.match(hub, /data-venue-content/);
});

test("item authoring applica lo stesso preflight anche sui deep link e rispetta il principal selezionato", () => {
  assert.match(itemEditor, /marketplaceRepository\.workspaceContext\(/);
  assert.match(itemEditor, /marketplaceRepository\.authoringPreflight\(/);
  assert.doesNotMatch(itemEditor, /marketplaceRepository\.workspace\(/);
  assert.match(itemEditor, /if \(!this\.preflight\?\.content\?\.allowed\)/);
  assert.match(itemEditor, /principalType/);
  assert.match(itemEditor, /principalId/);
});

test("il flusso oggetto fisico conserva il principal fino all'Item editor", () => {
  assert.match(hub, /workspace\/venue-targets\?venueId=.*principalQuery/);
  assert.match(venueChooser, /principalType/);
  assert.match(venueChooser, /principalId/);
  assert.match(venueChooser, /params\.set\("venueTargetId", target\.id\)/);
  assert.match(venueChooser, /workspace\/item-authoring\?\$\{params\.toString\(\)\}/);
});

test("Le mie risorse instrada la nuova creazione attraverso il hub", () => {
  assert.match(workspaceBrowser, /return `\/create\?\$\{p\.toString\(\)\}`/);
  assert.doesNotMatch(workspaceBrowser, />Crea un contenuto<\/a>/);
  assert.doesNotMatch(workspaceBrowser, />Crea una visita<\/a>/);
});