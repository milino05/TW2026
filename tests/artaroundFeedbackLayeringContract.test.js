const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const marketplaceRoot = path.join(root, "clients/marketplace/src");
const navigatorRoot = path.join(root, "clients/navigator/src");
const marketplaceStylesPath = path.join(marketplaceRoot, "styles/feedback-primitives.css");
const navigatorThemePath = path.join(navigatorRoot, "ui/theme.css");

function read(file) { return fs.readFileSync(file, "utf8"); }
function cssNumber(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : NaN;
}
function filesBelow(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...filesBelow(full));
    else if (/\.(?:css|js|ts|vue)$/.test(entry.name)) out.push(full);
  }
  return out;
}
function numericZIndexes(source) {
  return [...source.matchAll(/z-index\s*:\s*(-?\d+)/g)].map((match) => Number(match[1]));
}

const marketplaceStyles = read(marketplaceStylesPath);
const navigatorTheme = read(navigatorThemePath);
const marketplaceDialogLayer = cssNumber(marketplaceStyles, "--artaround-layer-dialog");
const marketplaceToastLayer = cssNumber(marketplaceStyles, "--artaround-layer-toast");
const navigatorDialogLayer = cssNumber(navigatorTheme, "--artaround-layer-dialog");
const navigatorToastLayer = cssNumber(navigatorTheme, "--artaround-layer-toast");

test("la scala globale riserva toast sopra dialog in entrambi i client", () => {
  for (const [dialog, toast] of [
    [marketplaceDialogLayer, marketplaceToastLayer],
    [navigatorDialogLayer, navigatorToastLayer],
  ]) {
    assert.ok(Number.isFinite(dialog));
    assert.ok(Number.isFinite(toast));
    assert.ok(dialog > 2_000_000_000);
    assert.ok(toast > dialog);
    assert.ok(toast <= 2_147_483_647);
  }
});

test("nessun overlay applicativo ordinario può superare il layer dei dialog globali", () => {
  const exemptions = new Set([
    path.normalize("clients/marketplace/src/styles/feedback-primitives.css"),
    path.normalize("clients/navigator/src/ui/FeedbackToastHost.vue"),
    path.normalize("clients/navigator/src/ui/FeedbackActionDialog.vue"),
    path.normalize("clients/navigator/src/ui/theme.css"),
  ]);

  const violations = [];
  for (const file of [...filesBelow(marketplaceRoot), ...filesBelow(navigatorRoot)]) {
    const relative = path.normalize(path.relative(root, file));
    if (exemptions.has(relative)) continue;
    for (const value of numericZIndexes(read(file))) {
      const budget = relative.startsWith(path.normalize("clients/navigator/"))
        ? navigatorDialogLayer
        : marketplaceDialogLayer;
      if (value >= budget) violations.push(`${relative}: z-index ${value} >= dialog layer ${budget}`);
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("gli host globali sfuggono agli stacking context locali", () => {
  const marketplacePrimitives = read(path.join(marketplaceRoot, "ui/feedback-primitives.js"));
  const navigatorToast = read(path.join(navigatorRoot, "ui/FeedbackToastHost.vue"));
  const navigatorDialog = read(path.join(navigatorRoot, "ui/FeedbackActionDialog.vue"));

  assert.match(marketplacePrimitives, /document\.body\.append\(document\.createElement\("artaround-toast-center"\)\)/);
  assert.match(marketplacePrimitives, /document\.body\.append\(dialog\)/);
  assert.match(navigatorToast, /<Teleport to="body">/);
  assert.match(navigatorDialog, /<Teleport to="body">/);
});
