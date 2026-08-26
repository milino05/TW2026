const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/commerce-management-view.js");
const repoPath = path.join(root, "clients/marketplace/src/infrastructure/http/marketplace-repository.js");
const utilsPath = path.join(root, "clients/marketplace/src/ui/commercial-utils.js");
const servicePath = path.join(root, "services/marketplaceCommercialV2.service.js");
const view = fs.readFileSync(viewPath, "utf8");
const repository = fs.readFileSync(repoPath, "utf8");
const utils = fs.readFileSync(utilsPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");

test("seller commerce boundary passa il syntax gate", () => {
  for (const target of [viewPath, repoPath, utilsPath, servicePath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("vendite derivano il seller dal contesto operativo", () => {
  assert.match(view, /readOperatingContext/);
  assert.match(view, /operatingPrincipal\(this\.context\)/);
  assert.match(view, /marketplaceRepository\.commerce/);
  assert.doesNotMatch(view, /data-commerce-principal|Vendite di|sellerPrincipalOptions|principalValue/);
  assert.doesNotMatch(utils, /sellerPrincipalOptions|beneficiaryOptions|principalOptions|principalValue/);
});

test("projection commerciale resta backend-authoritative", () => {
  assert.match(service, /getCommercialManagement/);
  assert.match(service, /assertCanActForPrincipal/);
  assert.match(service, /minimumOrganizationRole:\s*principalType === "organization" \? "manager" : "operator"/);
  assert.match(service, /availableOperations/);
  assert.match(repository, /commerce\(principal = \{\}/);
  assert.match(repository, /principalParams\(principal\)/);
});

test("offerte mantengono prezzo, diritti e policy di versione", () => {
  assert.match(view, /data-pricing-type/);
  assert.match(view, /pricingType/);
  assert.match(view, /amountMinor/);
  assert.match(view, /currency/);
  assert.match(view, /capability/);
  assert.match(view, /versionPolicy/);
  assert.match(view, /createOffer/);
});

test("dashboard vendite mantiene metriche e lifecycle di ritiro", () => {
  for (const term of ["Acquisizioni", "Adozioni", "Ricavi simulati", "Attività recente"]) assert.match(view, new RegExp(term));
  assert.match(view, /withdrawOffer/);
  assert.match(view, /withdrawListing/);
  assert.match(view, /data-confirm-withdraw/);
  assert.doesNotMatch(view, /window\.confirm\(/);
});

test("ritirare una nuova offerta non invalida acquisizioni già concluse", () => {
  assert.match(view, /acquisizioni già completate/);
  assert.match(view, /diritti già concessi/);
});
