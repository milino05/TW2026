const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const relative = "clients/marketplace/src/ui/acquisition-history-view.js";
const source = fs.readFileSync(path.join(root, relative), "utf8");

test("AcquisitionHistory usa QueryState e ResourceBrowserController", () => {
  assert.match(source, /import \{ QueryState \}/);
  assert.match(source, /import \{ ResourceBrowserController \}/);
  assert.match(source, /state = new QueryState\(\{ page: readPage\(\), pageSize: 20 \}\)/);
  assert.match(source, /new ResourceBrowserController/);
  assert.match(source, /marketplaceRepository\.acquisitionHistory\(\{ \.\.\.beneficiary, page \}\)/);
  assert.match(source, /this\.browser\.setPage/);
  assert.match(source, /this\.browser\.dispose\(\)/);
});

test("il beneficiary resta nel dominio e non diventa QueryState", () => {
  assert.match(source, /operatingPrincipal\(this\.context\)/);
  assert.match(source, /beneficiaryType: principal\.principalType/);
  assert.match(source, /beneficiaryId: principal\.principalId/);
  assert.doesNotMatch(source, /setFilter\("beneficiary/);
});

test("route e syntax dell'history restano compatibili", () => {
  assert.match(source, /url\.searchParams\.set\("page", String\(this\.state\.page\)\)/);
  assert.match(source, /data-history-page/);
  execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});
