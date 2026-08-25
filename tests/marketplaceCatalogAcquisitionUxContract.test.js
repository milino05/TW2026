const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  shell: "clients/marketplace/src/ui/app-shell.js",
  catalog: "clients/marketplace/src/ui/catalog-view.js",
  detail: "clients/marketplace/src/ui/listing-detail-view.js",
  history: "clients/marketplace/src/ui/acquisition-history-view.js",
  repo: "clients/marketplace/src/infrastructure/http/marketplace-repository.js",
  catalogService: "services/marketplaceCatalogV2.service.js",
  consumerService: "services/marketplaceConsumerProjectionV2.service.js",
  controller: "controllers/marketplaceV2.controller.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }

const shell = read("shell");
const catalog = read("catalog");
const detail = read("detail");
const history = read("history");
const repo = read("repo");
const consumerService = read("consumerService");
const catalogService = read("catalogService");
const controller = read("controller");

test("consumer marketplace boundary passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const target = path.join(root, file);
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Catalogo è una view consumer separata dalla app shell", () => {
  assert.match(shell, /import "\.\/catalog-view\.js"/);
  assert.match(shell, /<artaround-catalog-view>/);
  assert.doesNotMatch(shell, /marketplaceRepository|renderCatalog\(|data-catalog-filter|catalogQuery|selectedVenueIds/);
  assert.match(catalog, /marketplaceRepository\.catalog/);
  assert.match(catalog, /marketplaceRepository\.venueSelector/);
});

test("Catalogo è search-first, server-side e conserva lo stato nell'URL", () => {
  assert.match(catalog, /Cerca contenuti, visite o raccolte/);
  assert.match(catalog, /Filtri \(\$\{this\.filterCount\(\)\}\)/);
  assert.match(catalog, /selectedVenueIds/);
  assert.match(catalog, /resourceTypes:\s*TYPE_FILTERS/);
  assert.match(catalog, /data-catalog-page/);
  assert.match(catalog, /url\.searchParams\.set\("q"/);
  assert.match(catalog, /url\.searchParams\.set\("type"/);
  assert.doesNotMatch(catalog, /catalog-hero/);
});

test("repository HTTP mantiene il boundary ApiClient /api + route /v2", () => {
  assert.match(repo, /apiClient\.request\("\/v2\/marketplace\/venue-selector"\)/);
  assert.match(repo, /`\/v2\/marketplace\/listings\/\$\{encodeURIComponent\(listingId\)\}/);
  assert.match(repo, /beneficiaryType/);
  assert.match(repo, /beneficiaryId/);
  assert.doesNotMatch(repo, /apiClient\.(?:get|post)\(/);
  assert.doesNotMatch(repo, /["'`]\/api\/v2\/marketplace/);
});

test("dettaglio catalogo non dipende dal Creator Workspace", () => {
  assert.doesNotMatch(detail, /\.workspace\(/);
  assert.match(detail, /acquisitionContext/);
  assert.match(detail, /Aggiungi o acquista per/);
  assert.match(detail, /Aggiungi al tuo spazio/);
  assert.match(detail, /Acquista licenza/);
  assert.match(detail, /Pagamento simulato/);
  assert.match(detail, /Apri nelle mie risorse/);
  assert.match(detail, /Vedi la licenza/);
  assert.match(detail, /Dettagli tecnici della licenza/);
});

test("diritti del dettaglio sono calcolati rispetto al beneficiario selezionato", () => {
  assert.match(consumerService, /resolveCapabilityAccess/);
  assert.match(consumerService, /principalType:\s*context\.selectedBeneficiary\.type/);
  assert.match(consumerService, /principalId:\s*context\.selectedBeneficiary\.id/);
  assert.match(consumerService, /fullyAvailable/);
  assert.match(catalogService, /projectListingConsumerDetail/);
  assert.match(catalogService, /beneficiaryType/);
  assert.match(catalogService, /beneficiaryId/);
});

test("Le mie licenze distingue Acquisition immutabile e diritti Entitlement correnti", () => {
  assert.doesNotMatch(history, /\.workspace\(/);
  assert.match(history, /Le mie licenze/);
  assert.match(history, /currentRights/);
  assert.match(history, /availableBeneficiaries/);
  assert.match(history, /Dettagli tecnici dell'acquisizione/);
  assert.match(consumerService, /Entitlement\.find/);
  assert.match(consumerService, /sourceAcquisitionId/);
  assert.match(consumerService, /active:\s*nowWithin\(entitlement\)/);
  assert.match(controller, /enrichAcquisitionHistory/);
});

test("acquisizione resta diritto assegnato e non viene presentata come copia o adozione", () => {
  assert.match(detail, /I diritti restano assegnati al destinatario scelto/);
  assert.match(detail, /senza copiare o trasferire la proprietà della risorsa/);
  assert.doesNotMatch(detail, /adott/i);
  assert.doesNotMatch(history, /adott/i);
  assert.doesNotMatch(detail, /window\.confirm|window\.prompt/);
});
