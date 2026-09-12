const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const uiRoot = path.join(root, "clients/marketplace/src/ui");
const styleRoot = path.join(root, "clients/marketplace/src/styles");

function files(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(absolute, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [absolute] : [];
  });
}
function relative(file, base) { return path.relative(base, file).replaceAll("\\", "/"); }
function offenders(pattern, directory = uiRoot, extension = ".js") {
  return files(directory, extension)
    .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
    .map((file) => relative(file, directory))
    .sort();
}
function assertNone(pattern, label, directory = uiRoot, extension = ".js") {
  const found = offenders(pattern, directory, extension);
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
  assertNone(/<details[^>]*class=["'][^"']*(?:account-create|seller-offer-creator|venue-create)[^"']*["']/, "Create details");
});

test("gli stili legacy inspector e sidecar sono stati rimossi", () => {
  assertNone(/context-workspace-inspector|workspace-sidecar/, "Legacy interaction CSS", styleRoot, ".css");
});
