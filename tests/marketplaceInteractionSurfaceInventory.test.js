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

function assertAllowlisted(pattern, allowlist, label) {
  const unexpected = offenders(pattern).filter((file) => !allowlist.has(file));
  assert.deepEqual(unexpected, [], `${label}: nuove surface legacy non inventariate: ${unexpected.join(", ")}`);
}

test("non vengono introdotti nuovi inspector laterali durante la migrazione", () => {
  assertAllowlisted(
    /context-workspace-inspector-layer|context-workspace-inspector\b/,
    new Set(["workspace-browser-view.js", "workspace-view.js"]),
    "Inspector",
  );
});

test("non vengono introdotti nuovi sidecar sovrapposti", () => {
  assertAllowlisted(
    /workspace-sidecar(?:-|\b)/,
    new Set(["item-semantic-sidecar.js"]),
    "Sidecar",
  );
});

test("le confirmation-panel inline restano confinate ai consumer legacy già pianificati", () => {
  assertAllowlisted(
    /confirmation-panel/,
    new Set([
      "commerce-management-view.js",
      "organization-view.js",
      "physical-vocabulary-editor-view.js",
      "venue-editor-targets-mixin.js",
      "workspace-view.js",
    ]),
    "Inline confirmation",
  );
});

test("i details usati come create surface restano confinati ai consumer legacy da migrare", () => {
  assertAllowlisted(
    /<details[^>]*class=["'][^"']*(?:account-create|seller-offer-creator|venue-create)[^"']*["']/,
    new Set([
      "commerce-management-view.js",
      "organization-view.js",
      "profile-view.js",
      "venue-editor-targets-mixin.js",
    ]),
    "Create details",
  );
});
