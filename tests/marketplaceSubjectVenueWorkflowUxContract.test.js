const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const presence = read("clients/marketplace/src/ui/subject-presence.js");
const presenceRepository = read("clients/marketplace/src/infrastructure/http/subject-presence-repository.js");
const itemDetail = read("clients/marketplace/src/ui/item-detail-dialog.js");
const itemAuthoring = read("clients/marketplace/src/ui/item-authoring-view.js");
const targetDialog = read("clients/marketplace/src/ui/venue-target-create-dialog.js");
const resolver = read("services/venueSubjectResolver.service.js");
const usage = read("services/organizationSubjectUsage.service.js");
const operations = read("services/venueInventoryOperations.service.js");
const permissions = read("services/organizationPermissionRegistry.service.js");

function indexOfOrFail(source, pattern) {
  const match = source.match(pattern);
  assert.ok(match, `pattern missing: ${pattern}`);
  return match.index;
}

test("Subject→Venue usa un'unica surface con stati e CTA backend-authoritative", () => {
  assert.match(presence, /subject-venue-surface/);
  assert.match(presence, /venue\.inventory\.accept_proposal/);
  assert.match(presence, /venue\.inventory\.withdraw_proposal/);
  assert.match(presence, /venue\.inventory\.propose/);
  assert.match(presence, /venue\.inventory\.add/);
  assert.match(presence, /venue\.inventory\.open/);
  assert.match(presence, /venue\.map\.show/);
  assert.match(presence, /venuePriority/);
  assert.match(operations, /relationshipState/);
  assert.match(operations, /availableOperations/);
});

test("Item detail integra nativamente Sedi e Item authoring la espone solo nel controllo finale", () => {
  assert.match(itemDetail, /data-item-detail-tab="venues"/);
  assert.match(itemDetail, /artaround-subject-presence/);
  assert.match(itemDetail, /sourcePreviewMedia: this\.data\?\.item\?\.recognitionMedia/);
  assert.match(itemAuthoring, /openSubjectVenueDialog/);
  assert.match(itemAuthoring, /data-open-subject-venues/);
  assert.match(itemAuthoring, /sourcePreviewMedia: this\.projection\?\.lineage\?\.recognitionMedia/);
  assert.doesNotMatch(itemAuthoring, /renderSubjectPresence|artaround-subject-presence/);
});

test("Venue→Subject ranka l'intero insieme prima della paginazione", () => {
  assert.match(resolver, /recommendedOrganizationSubjectIds/);
  assert.match(resolver, /primarySubjectId/);
  assert.match(resolver, /projectOrganizationSubjectUsage/);
  assert.match(resolver, /right\.organizationUsage\.availableCount - left\.organizationUsage\.availableCount/);
  assert.match(resolver, /right\.organizationUsage\.draftCount - left\.organizationUsage\.draftCount/);
  assert.match(resolver, /right\.organizationUsage\.collectionCount - left\.organizationUsage\.collectionCount/);
  assert.match(resolver, /activityTime\(right\.organizationUsage\.lastActivityAt\)/);
  assert.ok(indexOfOrFail(resolver, /const ranked = subjects\.map/) < indexOfOrFail(resolver, /const results = ranked\.slice/));
  assert.doesNotMatch(resolver, /Subject\.find\(filter\)[\s\S]{0,100}\.skip\(/);
  assert.match(usage, /lastActivityAt/);
});

test("fallback Wikidata è esplicito e compare solo senza exact match ArtAround", () => {
  assert.match(targetDialog, /const canSearchExternal = Boolean\(query && !\(candidates\?\.exact \|\| \[\]\)\.length\)/);
  assert.match(targetDialog, /Cerca anche in Wikidata/);
  assert.match(targetDialog, /canSearchExternal \?/);
  assert.match(targetDialog, /artaround-semantic-entity-picker mode="subject" entity-kind="item"/);
});

test("metriche e preview restano proiezioni, con precedence all'Item chiamante", () => {
  assert.match(usage, /itemCount/);
  assert.match(usage, /availableCount/);
  assert.match(usage, /draftCount/);
  assert.match(usage, /collectionCount/);
  assert.match(usage, /venueCount/);
  assert.match(usage, /previewMedia/);
  assert.match(presence, /sourcePreviewMedia/);
  assert.match(presence, /countLabel\(usage\.venueCount/);
  assert.match(presence, /const media = this\.sourcePreviewMedia\?\.url \? this\.sourcePreviewMedia : usage\.previewMedia/);
});

test("propose e manage sono capability sorelle dipendenti da venue.view", () => {
  assert.match(permissions, /\["venue\.inventory\.propose", "Proporre entità per l'inventario della sede"\]/);
  assert.match(permissions, /"venue\.inventory\.propose": \["venue\.view"\]/);
  assert.match(permissions, /"venue\.inventory\.manage": \["venue\.view"\]/);
  assert.doesNotMatch(permissions, /"venue\.inventory\.manage": \["venue\.inventory\.propose"\]/);
  assert.match(presenceRepository, /origin: "item_authoring"/);
});

test("l'aggiunta diretta non richiede una conferma ridondante mentre accept/withdraw restano espliciti", () => {
  const addBranch = presence.match(/if \(code === "add"\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(addBranch, /subjectPresenceRepository\.addToInventory/);
  assert.doesNotMatch(addBranch, /openActionDialog/);
  assert.match(presence, /if \(code === "accept"\)[\s\S]*openActionDialog/);
  assert.match(presence, /if \(code === "withdraw"\)[\s\S]*openActionDialog/);
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
    "clients/marketplace/src/ui/item-detail-dialog.js",
    "clients/marketplace/src/ui/item-authoring-view.js",
    "clients/marketplace/src/ui/venue-target-create-dialog.js",
    "clients/marketplace/src/ui/venue-editor-subject-inventory-mixin.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
