const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "services/marketplaceAuthoringPreflightV2.service.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "controllers/marketplaceAuthoringPreflightV2.controller.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "routes/marketplaceV2.routes.js"), "utf8");

 test("preflight valida Namespace realmente utilizzabili tramite il boundary di authoring", () => {
  assert.match(service, /getNamespaceAuthoringControls/);
  assert.match(service, /durationTypes\.length/);
  assert.match(service, /languageLevels\.length/);
  assert.match(service, /NAMESPACE_REQUIRED/);
  assert.match(service, /NAMESPACE_CONTROLS_REQUIRED/);
});

test("preflight considera namespace.author owned e licensed nel principal selezionato", () => {
  assert.match(service, /resolveSelectedPrincipal/);
  assert.match(service, /capability: "namespace\.author"/);
  assert.match(service, /resourceType: \{ \$in: \["namespace", "namespace_revision"\] \}/);
});

test("preflight è esposto da un endpoint Marketplace autenticato", () => {
  assert.match(controller, /getMarketplaceAuthoringPreflight/);
  assert.match(routes, /\/v2\/marketplace\/authoring\/preflight/);
  assert.match(routes, /router\.use\(requireAuth\)/);
});