const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const presence = read("clients/marketplace/src/ui/subject-presence.js");
const presenceRepository = read("clients/marketplace/src/infrastructure/http/subject-presence-repository.js");
const itemDetailIntegration = read("clients/marketplace/src/ui/item-detail-subject-venues.js");
const itemAuthoringIntegration = read("clients/marketplace/src/ui/item-authoring-subject-venues.js");
const targetDialog = read("clients/marketplace/src/ui/venue-target-create-dialog.js");
const resolver = read("services/venueSubjectResolver.service.js");
const usage = read("services/organizationSubjectUsage.service.js");
const operations = read("services/venueInventoryOperations.service.js");
const permissions = read("services/organizationPermissionRegistry.service.js");

test("Subject→Venue usa un'unica surface con stati e CTA backend-authoritative", () => {
  assert.match(presence, /subject-venue-surface/);
  assert.match(presence, /venue\.inventory\.accept_proposal/);
  assert.match(presence, /venue\.inventory\.withdraw_proposal/);
  assert.match(presence, /venue\.inventory\.propose/);
  assert.match(presence, /venue\.inventory\.add/);
  assert.match(presence, /venue\.inventory\.open/);
  assert.match(presence, /venue\.map\.show/);
  assert.match(operations, /relationshipState/);
  assert.match(operations, /availableOperations/);
});

test("Item detail riusa la surface nella tab Sedi e Item authoring la espone solo come azione finale", () => {
  assert.match(itemDetailIntegration, /data-item-detail-tab="venues"/);
  assert.match(itemDetailIntegration, /artaround-subject-presence/);
  assert.match(itemAuthoringIntegration, /renderSubjectPresenceOutsideAuthoringFlow\(\) \{ return ""; \}/);
  assert.match(itemAuthoringIntegration, /renderStepFourWithSubjectVenue/);
  assert.match(itemAuthoringIntegration, /renderPrivateSuccessWithSubjectVenue/);
});

test("Venue→Subject parte dai Subject primari dell'organizzazione con metriche e fallback esplicito", () => {
  assert.match(resolver, /recommendedOrganizationSubjectIds/);
  assert.match(resolver, /primarySubjectId/);
  assert.match(resolver, /projectOrganizationSubjectUsage/);
  assert.match(usage, /itemCount/);
  assert.match(usage, /availableCount/);
  assert.match(usage, /draftCount/);
  assert.match(usage, /collectionCount/);
  assert.match(usage, /venueCount/);
  assert.match(usage, /previewMedia/);
  assert.match(targetDialog, /Dalla tua organizzazione/);
  assert.match(targetDialog, /Cerca anche in Wikidata/);
  assert.match(targetDialog, /subjectPresenceRepository\.get/);
  assert.doesNotMatch(targetDialog, /permissions\(\)\.can(?:Manage|Propose)Inventory/);
  assert.match(targetDialog, /Etichetta locale/);
  assert.match(targetDialog, /Nota d'inventario/);
  assert.match(targetDialog, /Messaggio ai responsabili dell'inventario/);
});

test("il permesso di proposta è indipendente da item.create e manage lo include", () => {
  assert.match(permissions, /\["venue\.inventory\.propose", "Proporre entità per l'inventario della sede"\]/);
  assert.match(permissions, /"venue\.inventory\.propose": \["venue\.view"\]/);
  assert.match(permissions, /"venue\.inventory\.manage": \["venue\.inventory\.propose"\]/);
  assert.match(permissions, /"venue\.inventory\.propose"/);
  assert.match(presenceRepository, /origin: "item_authoring"/);
});

test("i moduli Subject/Venue passano il syntax gate", () => {
  for (const relative of [
    "services/organizationSubjectUsage.service.js",
    "services/venueInventoryOperations.service.js",
    "services/venueInventoryCapabilities.service.js",
    "services/venueInventoryCommand.service.js",
    "services/venueSubjectResolver.service.js",
    "services/subjectVenuePresenceV2.service.js",
    "clients/marketplace/src/ui/subject-presence.js",
    "clients/marketplace/src/ui/subject-venue-dialog.js",
    "clients/marketplace/src/ui/item-detail-subject-venues.js",
    "clients/marketplace/src/ui/item-authoring-subject-venues.js",
    "clients/marketplace/src/ui/venue-target-create-dialog.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
