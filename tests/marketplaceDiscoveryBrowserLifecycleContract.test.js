const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const targets = [
  ["organizations", "clients/marketplace/src/ui/discovery-organizations-view.js", "discoveryRepository.organizations", "/organizations"],
  ["venues", "clients/marketplace/src/ui/discovery-venues-view.js", "discoveryRepository.venues", "/venues"],
];

for (const [name, relative, repositoryCall, route] of targets) {
  test(`${name}: directory discovery usa il browser lifecycle condiviso`, () => {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /import \{ QueryState \}/);
    assert.match(source, /import \{ ResourceBrowserController \}/);
    assert.match(source, /class DiscoveryQueryState extends QueryState/);
    assert.match(source, /new ResourceBrowserController/);
    assert.ok(source.includes(`${repositoryCall}({ q: query, page })`));
    assert.ok(source.includes(`navigate(\`${route}\${p.toString()`));
    assert.match(source, /this\.browser\.dispose\(\)/);
    assert.doesNotMatch(source, /this\.busy = true;\s*this\.error = null;\s*this\.render\(\);\s*try/s);
    execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
  });
}
