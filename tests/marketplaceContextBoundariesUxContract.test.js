const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  main: "clients/marketplace/src/main.js",
  validation: "clients/marketplace/src/ui/form-validation.js",
  formGuard: "clients/marketplace/src/ui/form-navigation-loss-guard.js",
  guardAdapter: "clients/marketplace/src/ui/legacy-feedback-surface-adapter.js",
  appShell: "clients/marketplace/src/ui/app-shell.js",
  createHub: "clients/marketplace/src/ui/create-hub-view.js",
  item: "clients/marketplace/src/ui/item-authoring-view.js",
  subjectPresence: "clients/marketplace/src/ui/subject-presence.js",
  organization: "clients/marketplace/src/ui/organization-view.js",
  venueEditorTargets: "clients/marketplace/src/ui/venue-editor-targets-mixin.js",
  venueEditorSlots: "clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js",
  venueInventoryProposals: "clients/marketplace/src/ui/venue-editor-inventory-proposals-mixin.js",
  venueMap: "clients/marketplace/src/ui/venue-map.js",
  publicVenue: "clients/marketplace/src/ui/public-venue-view.js",
  policy: "clients/marketplace/src/application/management-context-policy.js",
  managementRepository: "clients/marketplace/src/infrastructure/http/management-repository.js",
  venueAuthoringTargets: "services/venueAuthoringTargetsV2.service.js",
  discovery: "services/marketplaceDiscoveryV2.service.js",
  venueTargetModel: "models/venueTarget.model.js",
};
const read = (key) => fs.readFileSync(path.join(root, paths[key]), "utf8");
const source = Object.fromEntries(Object.keys(paths).map((key) => [key, read(key)]));

test("i moduli del boundary passano il syntax gate", () => {
  for (const relative of Object.values(paths).filter((value) => value.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("la navigazione di management cambia semanticamente col contesto operativo", () => {
  assert.match(source.appShell, /managementLabel = organizationContext \? "Gestisci" : "Account"/);
  assert.match(source.appShell, /organizationManagementHref\(this\.context\)/);
  assert.match(source.appShell, /\/organizations\/detail\?\$\{params\.toString\(\)\}/);
  assert.match(source.appShell, /route === "\/profile"\) return context\.type === "user"/);
  assert.match(source.appShell, /route === "\/organizations\/detail"/);
  assert.match(source.appShell, /String\(context\.id\) === String\(organizationId\)/);
  assert.match(source.appShell, /Cambia o crea area/);
  assert.doesNotMatch(source.appShell, /venue-target-chooser|\/workspace\/venue-targets/);
});

test("Organization management torna al Context Hub invece di attraversare l'Account personale", () => {
  assert.match(source.organization, /data-context-hub/);
  assert.match(source.organization, /navigate\("\/context"\)/);
  assert.match(source.organization, /Cambia area/);
  assert.match(source.organization, /Contesto e percorso/);
  assert.doesNotMatch(source.organization, /\/profile#account-organizations/);
});

test("le projection di management verificano l'owner contro l'area corrente", () => {
  assert.match(source.policy, /assertOwnerOperatingContext/);
  assert.match(source.policy, /context\.type !== ownerType/);
  assert.match(source.policy, /String\(value \|\| ""\)/);
  assert.match(source.managementRepository, /assertOrganizationOperatingContext\(organizationId/);
  assert.match(source.managementRepository, /projection\?\.namespace\?\.owner/);
  assert.match(source.managementRepository, /projection\?\.physicalVocabulary\?\.owner/);
  assert.match(source.managementRepository, /projection\?\.venue\?\.organizationId/);
});

test("Create Hub avvia l'Item dal Subject e non da una Venue o da un VenueTarget", () => {
  assert.match(source.createHub, /Parti dal Subject di cui vuoi parlare/);
  assert.match(source.createHub, /\/workspace\/item-authoring/);
  assert.doesNotMatch(source.createHub, /Sede di riferimento|Nessuna sede specifica|organizationVenues\(|venueTargetId|physicalIntent/);
});

test("Item Authoring usa il Subject come identità editoriale e mostra la presenza fisica come contesto separato", () => {
  assert.match(source.item, /preselectedSubjectId = params\(\)\.get\("subjectId"\)/);
  assert.match(source.item, /import "\.\/subject-presence\.js"/);
  assert.match(source.item, /artaround-subject-presence/);
  assert.doesNotMatch(source.item, /venueTargetId|physicalIntent|createItemWithPhysicalIntent|venueTargetContext/);
  assert.match(source.subjectPresence, /La presenza fisica è informativa e resta separata dal contenuto editoriale/);
  assert.match(source.subjectPresence, /Proponi alla sede/);
  assert.match(source.subjectPresence, /Mostra sulla mappa/);
});

test("l'inventario authoring legge tutti i VenueTarget attivi sulla configurazione effettiva", () => {
  assert.match(source.venueAuthoringTargets, /permissionCode: "venue\.view"/);
  assert.match(source.venueAuthoringTargets, /VenueTarget\.find\(\{ venueId: venue\._id, lifecycleStatus: "active" \}\)/);
  assert.match(source.venueAuthoringTargets, /view: "effective"/);
  assert.match(source.venueAuthoringTargets, /status: "unplaced"/);
  assert.match(source.venueAuthoringTargets, /inventoryRank/);
});

test("creazione contenuti e gestione inventario sono capability indipendenti", () => {
  assert.match(source.venueAuthoringTargets, /canCreateContent: authority\.effectivePermissions\.includes\("item\.create"\)/);
  assert.match(source.venueAuthoringTargets, /canEditInventory: authority\.effectivePermissions\.includes\("venue\.inventory\.manage"\)/);
  assert.match(source.managementRepository, /authoringPermissions: authoring\.permissions \|\| \{\}/);
  assert.match(source.venueEditorTargets, /canCreateContent = false/);
  assert.match(source.venueEditorTargets, /const createContent = canCreateContent/);
  assert.match(source.venueEditorTargets, /const subjectId = id\(entry\.subject\?\.id\)/);
  assert.match(source.venueEditorTargets, /subjectId=\$\{encodeURIComponent\(subjectId\)\}/);
  assert.match(source.venueEditorSlots, /this\.data\.authoringPermissions\?\.canCreateContent/);
  assert.match(source.venueEditorSlots, /const physicalActions = editable/);
  assert.match(source.venueEditorSlots, /const contentAction = canCreateContent/);
});

test("l'inbox Venue decide l'appartenenza all'inventario senza collocazione automatica", () => {
  assert.match(source.venueInventoryProposals, /canEditInventory/);
  assert.match(source.venueInventoryProposals, /acceptVenueInventoryProposal/);
  assert.match(source.venueInventoryProposals, /rejectVenueInventoryProposal/);
  assert.match(source.venueInventoryProposals, /Scrivi una motivazione prima di rifiutare la proposta/);
  assert.match(source.venueInventoryProposals, /senza collocazione automatica/);
  assert.match(source.venueInventoryProposals, /Nessuno slot verrà assegnato automaticamente/);
  assert.match(source.venueInventoryProposals, /La collocazione fisica resta nella sezione Spazi e mappa/);
});

test("l'inventario fisico resta scoped alla Venue", () => {
  assert.match(source.venueTargetModel, /venueId: \{ type: Schema\.Types\.ObjectId, ref: "Venue", required: true/);
  assert.match(source.venueTargetModel, /\{ venueId: 1, subjectId: 1 \}/);
  assert.match(source.venueTargetModel, /unique_active_venue_subject/);
});

test("la mappa pubblica deriva soltanto dalla release e dal layout pubblicati", () => {
  assert.match(source.discovery, /publishedReleaseId: \{ \$ne: null \}/);
  assert.match(source.discovery, /VenueRelease\.findOne\(\{ _id: venue\.publishedReleaseId, venueId: venue\._id, status: "published" \}\)/);
  assert.match(source.discovery, /LayoutRevision\.findOne\(\{ _id: release\.layoutRevisionId, venueId: venue\._id \}\)/);
  assert.match(source.discovery, /assignedVenueTargetId/);
  assert.match(source.publicVenue, /import "\.\/venue-map\.js"/);
  assert.match(source.publicVenue, /focusTargetId/);
  assert.match(source.publicVenue, /La mappa usa esclusivamente la VenueRelease pubblicata/);
  assert.match(source.venueMap, /Mostra esclusivamente la configurazione fisica pubblicata/);
  assert.match(source.venueMap, /focusContext\(\)/);
});

test("Item Authoring partecipa al navigation-loss guard usando la bozza reale", () => {
  assert.match(source.guardAdapter, /selector: "artaround-item-authoring-view"/);
  assert.match(source.guardAdapter, /editor\.readWorkingDraft\?\.\(\)/);
  assert.match(source.guardAdapter, /editor\.clearWorkingDraft\?\.\(\)/);
  assert.match(source.guardAdapter, /window\.addEventListener\("beforeunload"/);
  assert.match(source.guardAdapter, /hasNavigationLossRisk\(\)/);
});

test("i form di authoring e management diventano dirty solo dopo modifiche utente", () => {
  assert.match(source.main, /import "\.\/ui\/form-navigation-loss-guard\.js"/);
  for (const host of [
    "artaround-profile-view",
    "artaround-organization-view",
    "artaround-venue-editor-view",
    "artaround-visit-authoring-view",
    "artaround-item-authoring-view",
    "artaround-commerce-management-view",
  ]) assert.match(source.formGuard, new RegExp(host));
  assert.doesNotMatch(source.formGuard, /artaround-context-release-composer/);
  assert.match(source.formGuard, /document\.addEventListener\("input", markFromEvent, true\)/);
  assert.match(source.formGuard, /document\.addEventListener\("change", markFromEvent, true\)/);
  assert.match(source.formGuard, /dirtyForms\.add\(form\)/);
  assert.match(source.formGuard, /if \(!form\.isConnected\) dirtyForms\.delete\(form\)/);
  assert.match(source.formGuard, /formHasDedicatedDraftBlocker/);
  assert.match(source.formGuard, /itemEditor\?\.readWorkingDraft\?\.\(\)/);
  assert.match(source.formGuard, /registerNavigationLossBlocker/);
  assert.match(source.formGuard, /dirtyForms\.clear\(\)/);
  assert.match(source.formGuard, /TRANSIENT_FIELD_NAME/);
});

test("la selezione soggetto pre-creazione dell'Item è protetta senza bloccare preselezioni già persistite", () => {
  assert.match(source.formGuard, /dirtyItemSelections/);
  assert.match(source.formGuard, /document\.addEventListener\("subject-selected"/);
  assert.match(source.formGuard, /if \(editor && !editor\.itemId\) dirtyItemSelections\.add\(editor\)/);
  assert.match(source.formGuard, /if \(!editor\.isConnected \|\| editor\.itemId\) dirtyItemSelections\.delete\(editor\)/);
});

test("la validazione usa feedback inline condiviso invece del tooltip nativo", () => {
  assert.match(source.main, /import "\.\/ui\/form-validation\.js"/);
  assert.ok(source.main.indexOf('import "./ui/form-validation.js"') < source.main.indexOf('import "./ui/app-shell.js"'));
  assert.match(source.validation, /document\.addEventListener\("invalid"/);
  assert.match(source.validation, /event\.preventDefault\(\)/);
  assert.match(source.validation, /event\.stopPropagation\(\)/);
  assert.match(source.validation, /artaround-field-feedback/);
  assert.match(source.validation, /aria-invalid/);
  assert.match(source.validation, /scrollIntoView/);
  assert.match(source.validation, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(source.validation, /window\.alert|window\.confirm|window\.prompt/);
});