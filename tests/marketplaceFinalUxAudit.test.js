const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const marketRoot = path.join(root, "clients/marketplace/src");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function collectJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJs(full);
    return entry.isFile() && entry.name.endsWith(".js") ? [full] : [];
  });
}

const shell = read("clients/marketplace/src/ui/app-shell.js");
const router = read("clients/marketplace/src/application/router.js");
const context = read("clients/marketplace/src/application/operating-context.js");
const createHub = read("clients/marketplace/src/ui/create-hub-view.js");
const itemEditor = read("clients/marketplace/src/ui/item-authoring-view.js");
const visitEditor = read("clients/marketplace/src/ui/visit-authoring-view.js");
const commerce = read("clients/marketplace/src/ui/commerce-management-view.js");
const acquisition = read("clients/marketplace/src/ui/acquisition-history-view.js");
const organization = read("clients/marketplace/src/ui/organization-view.js");

test("tutto il client Marketplace passa il syntax gate JavaScript", () => {
  for (const target of collectJs(marketRoot)) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, target)}: ${result.stderr || result.stdout}`);
  }
});

test("il client non usa dialoghi nativi bloccanti", () => {
  for (const target of collectJs(marketRoot)) {
    const source = fs.readFileSync(target, "utf8");
    assert.doesNotMatch(source, /window\.(?:prompt|confirm)\s*\(/, path.relative(root, target));
  }
});

test("shell e router espongono la IA contestuale corrente", () => {
  for (const route of ["/context", "/home", "/catalog", "/organizations", "/venues", "/workspace", "/create", "/acquisitions", "/profile"]) {
    assert.match(router, new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  }
  for (const label of ["Home", "Esplora", "Libreria", "Crea", "Marketplace", "Account"]) {
    assert.match(shell, new RegExp(`>${label}<`));
  }
  assert.match(shell, /data-change-context/);
  assert.match(shell, /navigate\("\/context"\)/);
  assert.doesNotMatch(shell, />Le mie risorse</);
  assert.doesNotMatch(shell, />Licenze e vendite</);
  assert.doesNotMatch(shell, />Account e organizzazioni</);
});

test("il contesto operativo è session-scoped e non un contesto museo", () => {
  assert.match(context, /window\.sessionStorage/);
  assert.match(context, /type === "organization"/);
  assert.match(context, /type === "user"/);
  assert.match(context, /validateOperatingContext/);
  assert.doesNotMatch(context, /venueId|museumId|selectedVenueIds/);
});

test("le aree operative non reintroducono selector di principal", () => {
  for (const [name, source] of [["create hub", createHub], ["item editor", itemEditor], ["visit editor", visitEditor], ["commerce", commerce]]) {
    assert.doesNotMatch(source, /data-principal-form|data-new-principal|data-commerce-principal/, name);
  }
  assert.doesNotMatch(itemEditor, /changePrincipal\s*\(/);
  assert.doesNotMatch(visitEditor, /data-new-principal/);
  assert.match(acquisition, /operatingPrincipal\(this\.context\)/);
});

test("authoring e commerce mantengono feature parity strutturale", () => {
  for (const term of ["Di cosa parla", "Controllo finale", "data-new-edition", "data-content-space-id", "data-add-text", "data-remove-text"]) assert.match(itemEditor, new RegExp(term));
  for (const term of ["Informazioni principali", "Contenuti", "Tappe", "Logistica", "Riepilogo e pubblicazione", "data-add-content", "data-add-anchor"]) assert.match(visitEditor, new RegExp(term));
  for (const term of ["Schede nel catalogo", "Nuova offerta", "data-pricing-type", "withdrawOffer", "withdrawListing"]) assert.match(commerce, new RegExp(term));
});

test("management Organization resta separato dal profilo pubblico", () => {
  assert.match(organization, /Gestione organizzazione/);
  assert.match(organization, /data-public-profile/);
  assert.match(organization, /\/organizations\/public\?organizationId=/);
  for (const operation of ["organization.member.add", "venue.create", "namespace.create"]) {
    assert.match(organization, new RegExp(operation.replaceAll(".", "\\.")));
  }
});
