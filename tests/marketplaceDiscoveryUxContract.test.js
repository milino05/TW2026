const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  service: "services/marketplaceDiscoveryV2.service.js",
  controller: "controllers/marketplaceDiscoveryV2.controller.js",
  routes: "routes/marketplaceV2.routes.js",
  organizations: "clients/marketplace/src/ui/discovery-organizations-view.js",
  venues: "clients/marketplace/src/ui/discovery-venues-view.js",
  publicOrganization: "clients/marketplace/src/ui/public-organization-view.js",
  publicVenue: "clients/marketplace/src/ui/public-venue-view.js",
  explore: "clients/marketplace/src/ui/explore-navigation.js",
};
const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));

test("discovery Marketplace passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Venue directory e profilo pubblico espongono solo configurazioni pubblicate", () => {
  assert.match(source.service, /publishedReleaseId:\s*\{ \$ne: null \}/);
  assert.match(source.service, /VenueRelease\.findOne\([\s\S]*status:\s*"published"/);
  assert.match(source.service, /targetBindings/);
  assert.match(source.service, /availability === "active"/);
});

test("profilo Organization separa ownership delle pubblicazioni da rilevanza fisica", () => {
  assert.match(source.service, /sellerType:\s*"organization"/);
  assert.match(source.service, /sellerId:\s*organization\._id/);
  assert.match(source.publicOrganization, /Pubblicazioni dell'organizzazione/);
  assert.match(source.publicVenue, /Catalogo mostra tutte le risorse pertinenti alla sede/);
  assert.match(source.publicVenue, /selectedVenueIds=/);
});

test("discovery e management usano route distinte", () => {
  assert.match(source.routes, /discovery\/organizations/);
  assert.match(source.routes, /discovery\/venues/);
  assert.match(source.publicOrganization, /Gestisci organizzazione/);
  assert.doesNotMatch(source.publicOrganization, /data-add-member|data-create-venue|data-create-namespace/);
});

test("Esplora usa una sola sott navigazione Catalogo Organizzazioni Sedi", () => {
  for (const label of ["Catalogo", "Organizzazioni", "Sedi"]) assert.match(source.explore, new RegExp(label));
  assert.match(source.organizations, /renderExploreNavigation\("organizations"\)/);
  assert.match(source.venues, /renderExploreNavigation\("venues"\)/);
  assert.match(source.publicOrganization, /renderExploreNavigation\("organizations"\)/);
  assert.match(source.publicVenue, /renderExploreNavigation\("venues"\)/);
});
