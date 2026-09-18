const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

test("Navigator v3 usa asset stabili Mongo senza spostare la configurazione nel DB", () => {
  const model = read("models/navigatorAsset.model.js");
  const service = read("services/navigatorVenueConfig.service.js");
  const navigator = read("clients/navigator/src/domain/navigatorStaticConfig.ts");

  assert.match(model, /collection: "navigator_assets"/);
  assert.match(model, /organizationId/);
  assert.match(model, /data: \{ type: Buffer/);
  assert.match(service, /schemaVersion: 3/);
  assert.match(service, /navigator\.config\.json/);
  assert.match(service, /assetId/);
  assert.match(service, /venue\.profile\.manage/);
  assert.match(service, /migrateLegacyVenueConfig/);
  assert.match(navigator, /\/api\/navigator-assets\/\$\{encodeURIComponent\(asset\.assetId\)\}/);
});

test("Marketplace espone modifica, copia, import ed export della configurazione Venue", () => {
  const repository = read("clients/marketplace/src/infrastructure/http/navigator-config-repository.js");
  const editor = read("clients/marketplace/src/ui/venue-editor-navigator-mixin.js");
  const venueView = read("clients/marketplace/src/ui/venue-editor-view.js");

  assert.match(repository, /navigator-config/);
  assert.match(repository, /uploadAsset/);
  assert.match(repository, /copy\(/);
  assert.match(editor, /data-navigator-config/);
  assert.match(editor, /data-navigator-copy/);
  assert.match(editor, /data-navigator-import/);
  assert.match(editor, /data-navigator-export/);
  assert.match(editor, /data-navigator-asset-upload/);
  assert.match(venueView, /"navigator"/);
});

test("le route separano asset pubblico e gestione autenticata della configurazione", () => {
  const routes = read("routes/venues.routes.js");
  assert.match(routes, /router\.get\("\/navigator-assets\/:assetId", assetId, navigatorConfigController\.navigatorAsset\)/);
  assert.match(routes, /router\.get\("\/venues\/:venueId\/navigator-config", requireAuth/);
  assert.match(routes, /router\.put\("\/venues\/:venueId\/navigator-config", requireAuth/);
  assert.match(routes, /router\.post\("\/venues\/:venueId\/navigator-config\/assets", requireAuth/);
  assert.match(routes, /router\.post\("\/venues\/:venueId\/navigator-config\/copy", requireAuth/);
});
