const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  context: "clients/marketplace/src/application/operating-context.js",
  router: "clients/marketplace/src/application/router.js",
  shell: "clients/marketplace/src/ui/app-shell.js",
  hub: "clients/marketplace/src/ui/context-hub-view.js",
  home: "clients/marketplace/src/ui/home-view.js",
  create: "clients/marketplace/src/ui/create-hub-view.js",
  workspace: "clients/marketplace/src/ui/workspace-browser-view.js",
  item: "clients/marketplace/src/ui/item-authoring-view.js",
  visit: "clients/marketplace/src/ui/visit-authoring-view.js",
  commerce: "clients/marketplace/src/ui/commerce-management-view.js",
  acquisition: "clients/marketplace/src/ui/acquisition-history-view.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));

test("Context Hub boundary passa il syntax gate", () => {
  for (const file of Object.values(paths)) {
    const target = path.join(root, file);
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("il contesto operativo è una preferenza di sessione validata sull'account workspace", () => {
  assert.match(source.context, /sessionStorage\.getItem/);
  assert.match(source.context, /sessionStorage\.setItem/);
  assert.match(source.context, /availableOperatingContexts/);
  assert.match(source.context, /validateOperatingContext/);
  assert.match(source.context, /workspace\.account/);
  assert.match(source.context, /workspace\.organizations/);
  assert.doesNotMatch(source.context, /venueId|museumId|selectedVenueIds/);
});

test("utente autenticato senza contesto viene portato al Context Hub", () => {
  assert.match(source.shell, /!this\.context && currentRoute\(\) !== "\/context"/);
  assert.match(source.shell, /navigate\("\/context"\)/);
  assert.match(source.shell, /clearOperatingContext/);
  assert.match(source.shell, /data-change-context/);
});

test("l'identità dell'area personale mostra lo username sotto la tipologia", () => {
  assert.match(source.shell, /this\.context\.type === "user" \? \(this\.context\.name \|\| this\.user\?\.username/);
  assert.doesNotMatch(source.shell, /this\.context\.type === "user" \? "Area personale" : this\.context\.name/);
});

test("Context Hub espone area personale, organizzazioni e creazione Organization", () => {
  assert.match(source.hub, /accountRepository\.workspace\(\)/);
  assert.match(source.hub, /data-context-type="user"/);
  assert.match(source.hub, /data-context-type="organization"/);
  assert.match(source.hub, /organization\.create/);
  assert.match(source.hub, /accountRepository\.createOrganization/);
  assert.match(source.hub, /setOperatingContext/);
  assert.match(source.hub, /navigate\("\/home"\)/);
});

test("Home e aree operative consumano il contesto senza permettere selezioni locali", () => {
  assert.match(source.home, /readOperatingContext/);
  for (const key of ["create", "workspace", "item", "visit", "commerce", "acquisition"]) {
    assert.match(source[key], /readOperatingContext/, `${key} deve leggere il contesto operativo`);
    assert.doesNotMatch(source[key], /data-principal-form|data-new-principal|data-commerce-principal/, `${key} non deve reintrodurre selector locali`);
  }
});

test("route Context Hub, Home e discovery Organization/Venue sono parte del router", () => {
  for (const route of ["/context", "/home", "/organizations", "/organizations/public", "/venues", "/venues/public"]) {
    assert.match(source.router, new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  }
});

test("il contesto non viene serializzato nei link di creazione", () => {
  assert.doesNotMatch(source.create, /principalType|principalId/);
  assert.doesNotMatch(source.workspace, /\/create\?[^"'`]*principal/);
  assert.doesNotMatch(source.item, /searchParams\.set\("principal(?:Type|Id)"/);
});
