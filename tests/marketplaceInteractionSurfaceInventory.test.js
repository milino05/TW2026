const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const uiRoot = path.join(root, "clients/marketplace/src/ui");

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  });
}

function relative(file) { return path.relative(uiRoot, file).replaceAll("\\", "/"); }
function offenders(pattern) {
  return javascriptFiles(uiRoot)
    .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
    .map(relative)
    .sort();
}

function assertNone(pattern, label) {
  const found = offenders(pattern);
  assert.deepEqual(found, [], `${label}: surface legacy residue: ${found.join(", ")}`);
}

test("Marketplace non usa più inspector laterali come interaction surface", () => {
  assertNone(/context-workspace-inspector-layer|context-workspace-inspector\b/, "Inspector");
});

test("Marketplace non usa più sidecar sovrapposti", () => {
  assertNone(/workspace-sidecar(?:-|\b)/, "Sidecar");
});

test("Marketplace non usa più confirmation-panel inline", () => {
  assertNone(/confirmation-panel/, "Inline confirmation");
});

test("Marketplace non usa details come create surface applicativa", () => {
  assertNone(
    /<details[^>]*class=["'][^"']*(?:account-create|seller-offer-creator|venue-create)[^"']*["']/,
    "Create details",
  );
});
