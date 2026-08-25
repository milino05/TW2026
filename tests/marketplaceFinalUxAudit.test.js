const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const marketplace = path.join(root, "clients/marketplace");
const uiDir = path.join(marketplace, "src/ui");
const srcDir = path.join(marketplace, "src");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function allUiSource() {
  return jsFiles(uiDir).map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

test("tutto il frontend Marketplace passa il syntax gate JavaScript", () => {
  for (const file of jsFiles(srcDir)) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, file)}\n${result.stderr || result.stdout}`);
  }
});

test("nessuna view Marketplace usa prompt o confirm nativi", () => {
  const source = allUiSource();
  assert.doesNotMatch(source, /window\.prompt\s*\(/);
  assert.doesNotMatch(source, /window\.confirm\s*\(/);
});

test("shell e router mantengono le cinque aree e tutte le route funzionali", () => {
  const shell = read("clients/marketplace/src/ui/app-shell.js");
  const router = read("clients/marketplace/src/application/router.js");
  for (const label of ["Catalogo", "Le mie risorse", "Crea", "Licenze e vendite", "Account e organizzazioni"]) assert.match(shell, new RegExp(label));
  for (const route of ["/catalog/detail", "/acquisitions", "/create", "/workspace/resource", "/workspace/commerce", "/workspace/item-authoring", "/workspace/visit-authoring", "/workspace/venue-targets", "/workspace/context-compose", "/profile", "/organizations/detail", "/namespaces/editor", "/venues/editor"]) assert.match(router, new RegExp(route.replaceAll("/", "\\/")));
});

test("la navigazione tablet non ricade nello stato a sole icone", () => {
  const css = read("clients/marketplace/src/styles/final-audit.css");
  assert.match(css, /max-width:68rem/);
  assert.match(css, /\.market-nav a span,\.market-nav button span\{display:inline\}/);
  assert.match(css, /\.menu-toggle\{display:inline-flex/);
});

test("dettaglio risorsa usa motivazione inline per le operazioni che la richiedono", () => {
  const source = read("clients/marketplace/src/ui/workspace-view.js");
  assert.match(source, /pendingOperation/);
  assert.match(source, /data-operation-message/);
  assert.match(source, /data-confirm-operation-message/);
  assert.match(source, /requiresMessage/);
  assert.doesNotMatch(source, /window\.prompt|window\.confirm/);
});

test("composer della raccolta usa microcopy user-facing e mantiene i riferimenti tecnici in disclosure", () => {
  const source = read("clients/marketplace/src/ui/context-release-composer.js");
  for (const token of ["Pubblica una nuova versione", "Raccolta editoriale", "Spazio editoriale", "Regole editoriali", "Contenuti della nuova versione", "Dettagli tecnici della versione"]) assert.match(source, new RegExp(token));
  assert.match(source, /NamespaceRevision/);
  assert.match(source, /GraphRevision/);
  assert.doesNotMatch(source, /<h1>Componi la release<\/h1>|>Workspace<|>Editorial release/);
});

test("feature parity trasversale resta rappresentata nei flussi principali", () => {
  const expectations = {
    "clients/marketplace/src/ui/catalog-view.js": ["selectedVenueIds", "resourceType", "page"],
    "clients/marketplace/src/ui/listing-detail-view.js": ["beneficiary", "acquisition"],
    "clients/marketplace/src/ui/acquisition-history-view.js": ["currentRights", "availableBeneficiaries"],
    "clients/marketplace/src/ui/workspace-browser-view.js": ["ownership", "workspaceResources"],
    "clients/marketplace/src/ui/create-hub-view.js": ["authoringPreflight"],
    "clients/marketplace/src/ui/item-authoring-view.js": ["presentationVariants", "representations", "workflow"],
    "clients/marketplace/src/ui/visit-authoring-view.js": ["deliveryAnchorId", "preVisitNotes", "routeHints"],
    "clients/marketplace/src/ui/commerce-management-view.js": ["createOffer", "withdraw"],
    "clients/marketplace/src/ui/organization-view.js": ["organization.member", "venue.create", "namespace.create"],
    "clients/marketplace/src/ui/namespace-editor-view.js": ["semanticRefs", "namespace.revision.publish"],
    "clients/marketplace/src/ui/venue-editor-view.js": ["venueDraftMixin", "venueTargetsMixin", "venueRoutingMixin"],
  };
  for (const [file, tokens] of Object.entries(expectations)) {
    const source = read(file);
    for (const token of tokens) assert.match(source, new RegExp(token), `${file} deve preservare ${token}`);
  }
});
