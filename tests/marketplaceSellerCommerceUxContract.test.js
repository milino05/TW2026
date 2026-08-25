const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  view: "clients/marketplace/src/ui/commerce-management-view.js",
  utils: "clients/marketplace/src/ui/commercial-utils.js",
  service: "services/marketplaceCommercialV2.service.js",
  repo: "clients/marketplace/src/infrastructure/http/marketplace-repository.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }

const view = read("view");
const utils = read("utils");
const service = read("service");
const repo = read("repo");

test("seller commerce boundary passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const target = path.join(root, file);
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Vendite usa una projection seller unica e non ricostruisce la dashboard da una seconda chiamata", () => {
  assert.match(view, /marketplaceRepository\.commerce/);
  assert.doesNotMatch(view, /marketplaceRepository\.distribution/);
  assert.match(view, /this\.data\?\.distribution/);
  assert.match(service, /getDistributionDashboard/);
  assert.match(service, /distribution:\s*await hydrateDistribution/);
});

test("la UI seller usa microcopy task-oriented e progressive disclosure", () => {
  assert.match(view, />Vendite</);
  assert.match(view, /Vendite di/);
  assert.match(view, /Schede nel catalogo/);
  assert.match(view, /Nuova offerta/);
  assert.match(view, /Cosa ottiene chi acquisisce/);
  assert.match(view, /Aggiornamenti inclusi/);
  assert.match(view, /Dettagli tecnici dell’offerta/);
  assert.match(view, /Dettagli tecnici della scheda/);
  assert.match(utils, /sellerPrincipalOptions/);
});

test("prezzo paid è progressive e i diritti restano capability backend-authoritative", () => {
  assert.match(view, /data-pricing-type/);
  assert.match(view, /data-paid-fields/);
  assert.match(view, /paidFields\.hidden = select\.value !== "paid"/);
  assert.match(view, /listing\.offerConfiguration\.resourceRef/);
  assert.match(view, /hasOperation\(listing\.availableOperations, "create_offer"\)/);
  assert.match(view, /hasOperation\(offer\.availableOperations, "withdraw_offer"\)/);
  assert.match(view, /hasOperation\(listing\.availableOperations, "withdraw_listing"\)/);
});

test("dashboard seller riceve titoli, nomi e label adozione dal backend", () => {
  assert.match(service, /ADOPTION_ACTION_LABELS/);
  assert.match(service, /MarketplaceListing\.find/);
  assert.match(service, /User\.find/);
  assert.match(service, /Organization\.find/);
  assert.match(service, /asset:\s*\{/);
  assert.match(service, /actionLabel:/);
  assert.match(view, /sale\.asset\?\.title/);
  assert.match(view, /sale\.buyer\?\.name/);
  assert.match(view, /adoption\.actionLabel/);
  assert.match(view, /adoption\.beneficiary\?\.name/);
});

test("ritiro spiega le conseguenze e non modifica semanticamente acquisizioni o diritti", () => {
  assert.match(view, /Le acquisizioni già completate e i diritti già concessi resteranno validi/);
  assert.match(view, /marketplaceRepository\.withdrawOffer/);
  assert.match(view, /marketplaceRepository\.withdrawListing/);
  assert.doesNotMatch(view, /window\.confirm|window\.prompt/);
});

test("il refactor seller non altera il contratto HTTP del repository", () => {
  assert.match(repo, /apiClient\.request\(`?\/v2\/marketplace/);
  assert.doesNotMatch(repo, /apiClient\.(?:get|post)\(/);
  assert.doesNotMatch(repo, /\/api\/v2\/marketplace/);
});
