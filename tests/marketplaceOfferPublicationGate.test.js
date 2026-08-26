const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  marketplace: path.join(root, "services/marketplaceV2.service.js"),
  catalog: path.join(root, "services/marketplaceCatalogV2.service.js"),
  commercial: path.join(root, "services/marketplaceCommercialV2.service.js"),
  workspace: path.join(root, "clients/marketplace/src/ui/workspace-view.js"),
  commerce: path.join(root, "clients/marketplace/src/ui/commerce-management-view.js"),
};
const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));

test("il gate offerta-pubblicazione passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("creare la scheda prepara una bozza e la prima offerta la pubblica", () => {
  assert.match(source.marketplace, /status: "draft",[\s\S]*?publishedAt: null/);
  assert.match(source.marketplace, /status: \{ \$in: \["draft", "published"\] \}/);
  assert.match(source.marketplace, /offer = await MarketplaceOffer\.create/);
  assert.match(source.marketplace, /\$set: \{ status: "published", publishedAt: new Date\(\)/);
  assert.match(source.marketplace, /if \(!offers\.length\) return null/);
});

test("catalogo e dettaglio richiedono sempre almeno un'offerta attiva", () => {
  assert.match(source.catalog, /MarketplaceOffer\.distinct\("listingId", \{ status: "active" \}\)/);
  assert.match(source.catalog, /status: "published", _id: \{ \$in: activeListingIds \}/);
  assert.match(source.catalog, /MarketplaceOffer\.exists\(\{ listingId: listing\._id, status: "active" \}\)/);
  assert.match(source.catalog, /ACTIVE_OFFER_REQUIRED/);
});

test("la UI guida direttamente alla formulazione dell'offerta", () => {
  assert.match(source.workspace, /Configura offerta e pubblica/);
  assert.match(source.workspace, /\/workspace\/commerce\?listingId=/);
  assert.match(source.commerce, /Una risorsa appare nel Catalogo solo dopo la pubblicazione di almeno un’offerta/);
  assert.match(source.commerce, /Non ancora visibile nel Catalogo/);
  assert.match(source.commerce, /open: !hasActiveOffer/);
  assert.match(source.commerce, /Pubblica offerta/);
  assert.match(source.commercial, /\["draft", "published"\]\.includes\(listing\.status\)/);
});
