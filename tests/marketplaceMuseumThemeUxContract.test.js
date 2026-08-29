const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const marketplace = read("clients/marketplace/src/styles/marketplace.css");
const contextShell = read("clients/marketplace/src/styles/context-shell.css");
const consumerMarketplace = read("clients/marketplace/src/styles/consumer-marketplace.css");

test("il Marketplace usa la nuova identità porpora e le superfici calde", () => {
  assert.match(marketplace, /--ink-900:#641c3b/);
  assert.match(marketplace, /--surface:#fffdfa/);
  assert.match(marketplace, /--canvas:#f4f0eb/);
  assert.match(marketplace, /--line:#dfd5d0/);
  assert.doesNotMatch(marketplace, /--ink-900:#173b32/);
});

test("la gerarchia editoriale resta separata dai controlli operativi", () => {
  assert.match(marketplace, /--font-ui:Inter/);
  assert.match(marketplace, /--font-editorial:/);
  assert.match(marketplace, /h1,h2,h3\{font-family:var\(--font-editorial\)/);
  assert.match(marketplace, /body,button,input,select,textarea\{font-family:inherit\}/);
});

test("home e catalogo ereditano il tema senza modificare il layout", () => {
  assert.match(contextShell, /\.home-hero\{background:var\(--surface\)\}/);
  assert.match(contextShell, /\.home-actions\{display:grid;grid-template-columns:repeat\(4/);
  assert.match(consumerMarketplace, /rgba\(100,28,59,\.22\)/);
  assert.match(consumerMarketplace, /\.consumer-catalog \.catalog-grid\{grid-template-columns:repeat\(2/);
});
