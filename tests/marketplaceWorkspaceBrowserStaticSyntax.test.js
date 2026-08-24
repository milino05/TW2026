const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const browserPath = path.join(root, "clients/marketplace/src/ui/workspace-browser-view.js");
const syntaxTargets = [
  "services/marketplaceWorkspaceResourcesV2.service.js",
  "controllers/marketplaceV2.controller.js",
  "routes/marketplaceV2.routes.js",
  "clients/marketplace/src/infrastructure/http/marketplace-repository.js",
  "clients/marketplace/src/ui/app-shell.js",
  "clients/marketplace/src/ui/workspace-browser-view.js",
];

test("workspace browser boundary passes the JavaScript syntax gate", () => {
  for (const relativePath of syntaxTargets) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relativePath}: ${result.stderr || result.stdout}`);
  }
});

test("workspace browser keeps accessibility landmarks", () => {
  const source = fs.readFileSync(browserPath, "utf8");
  assert.match(source, /export class ArtAroundWorkspaceBrowserView extends HTMLElement/);
  assert.match(source, /customElements\.define\("artaround-workspace-browser-view"/);
  assert.match(source, /role="search"/);
  assert.match(source, /aria-label="Pagine delle risorse"/);
});
