const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  catalog: "clients/marketplace/src/ui/catalog-view.js",
  detail: "clients/marketplace/src/ui/listing-detail-view.js",
  history: "clients/marketplace/src/ui/acquisition-history-view.js",
  repository: "clients/marketplace/src/infrastructure/http/marketplace-repository.js",
  context: "clients/marketplace/src/application/operating-context.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const catalog = read("catalog");
const detail = read("detail");
const history = read("history");
const repository = read("repository");
const context = read("context");
const consumerStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/consumer-marketplace.css"), "utf8");

test("catalogo, dettaglio e acquisizioni passano il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Catalogo mantiene discovery multi-asset, ricerca e filtro multi-sede", () => {
  assert.match(catalog, /TYPE_FILTERS/);
  assert.match(catalog, /data-catalog-search/);
  assert.match(catalog, /selectedVenueIds/);
  assert.match(catalog, /getAll\("selectedVenueIds"\)/);
  assert.match(catalog, /marketplaceRepository\.catalog/);
  assert.match(catalog, /renderExploreNavigation\("catalog"\)/);
});

test("il selettore delle sedi resta nascosto finché non si cerca ed è usabile con centinaia di musei", () => {
  assert.match(catalog, /data-venue-search/);
  assert.match(catalog, /normalizeVenueSearch/);
  assert.match(catalog, /MIN_VENUE_QUERY_LENGTH = 2/);
  assert.match(catalog, /const searchReady = query\.length >= MIN_VENUE_QUERY_LENGTH/);
  assert.match(catalog, /const matches = searchReady &&/);
  assert.match(catalog, /filterVenueOptions\(\)/);
  assert.match(catalog, /data-venue-search-text/);
  assert.match(catalog, /data-venue-search-prompt/);
  assert.match(catalog, /Le organizzazioni e le sedi vengono mostrate soltanto dopo una ricerca/);
  assert.match(catalog, /data-venue-result-count/);
  assert.match(catalog, /data-clear-venue-search/);
  assert.match(catalog, /data-remove-selected-venue/);
  assert.match(catalog, /event\.key === "Enter"/);
  assert.match(consumerStyles, /consumer-venue-prompt\{[^}]*border:[^}]*dashed/);
  assert.match(consumerStyles, /consumer-venue-results\{[^}]*max-height:[^}]*overflow:auto/);
  assert.match(consumerStyles, /consumer-venue-group legend\{[^}]*position:sticky/);
  assert.match(consumerStyles, /consumer-venue-search__control \.input-icon:focus-within\{[^}]*outline:0[^}]*box-shadow/);
  assert.match(consumerStyles, /consumer-venue-search__control input:focus\{[^}]*outline:0/);
  assert.match(consumerStyles, /consumer-filter-count\{[^}]*flex:0 0 1\.7rem[^}]*border-radius:\.45rem/);
  assert.match(consumerStyles, /consumer-filters:not\(\[open\]\)>summary\{display:flex/);
});

test("beneficiary commerciale deriva dal Context Hub e non da un selector locale", () => {
  assert.match(detail, /readOperatingContext/);
  assert.match(detail, /operatingPrincipal/);
  assert.match(detail, /beneficiary\(\)/);
  assert.match(detail, /area di lavoro corrente/);
  assert.doesNotMatch(detail, /availableBeneficiaries|beneficiaryOptions|data-beneficiary|Aggiungi o acquista per/);
  assert.match(context, /sessionStorage/);
});

test("il boundary HTTP continua a trasmettere il beneficiary esplicito al backend", () => {
  assert.match(repository, /detail\(listingId, \{ selectedVenueIds = \[\], beneficiaryType = null, beneficiaryId = null \}/);
  assert.match(repository, /acquire\(offerId, \{ beneficiaryType = "user", beneficiaryId = null \}/);
  assert.match(repository, /JSON\.stringify\(\{ beneficiaryType, beneficiaryId \}\)/);
  assert.match(repository, /acquisitionHistory\(\{ page = 1, limit = 20, beneficiaryType = "user", beneficiaryId = null \}/);
});

test("acquisizioni e diritti sono contestuali senza selector duplicato", () => {
  assert.match(history, /readOperatingContext/);
  assert.match(history, /operatingPrincipal\(this\.context\)/);
  assert.match(history, /currentRights/);
  assert.match(history, /Acquisizioni e licenze/);
  assert.doesNotMatch(history, /availableBeneficiaries|beneficiaryOptions|data-beneficiary/);
});

test("acquisire non copia né trasferisce la proprietà editoriale", () => {
  assert.match(detail, /senza copiare o trasferire la proprietà della risorsa/);
  assert.match(detail, /Aggiungi alla libreria/);
  assert.match(detail, /Apri in Libreria/);
});

test("l'immagine facoltativa del contenuto compare nel catalogo e nel dettaglio", () => {
  assert.match(catalog, /asset\.illustrativeMedia\?\.\[0\]/);
  assert.match(catalog, /consumer-catalog-card__preview/);
  assert.match(catalog, /loading="lazy"/);
  assert.match(detail, /asset\.illustrativeMedia\?\.\[0\]/);
  assert.match(detail, /consumer-detail__image/);
  assert.match(consumerStyles, /consumer-catalog-card__preview\{[^}]*object-fit:cover/);
  assert.match(consumerStyles, /consumer-detail__image\{[^}]*aspect-ratio:4\/3[^}]*object-fit:cover/);
});
