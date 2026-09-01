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
  organization: "clients/marketplace/src/ui/organization-view.js",
  venueChooser: "clients/marketplace/src/ui/venue-target-chooser.js",
  venueEditorTargets: "clients/marketplace/src/ui/venue-editor-targets-mixin.js",
  venueEditorSlots: "clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js",
  policy: "clients/marketplace/src/application/management-context-policy.js",
  managementRepository: "clients/marketplace/src/infrastructure/http/management-repository.js",
  venueAuthoringTargets: "services/venueAuthoringTargetsV2.service.js",
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

test("la creazione item in organization context può selezionare la Venue senza renderla obbligatoria", () => {
  assert.match(source.createHub, /Sede di riferimento/);
  assert.match(source.createHub, /Nessuna sede specifica/);
  assert.match(source.createHub, /organizationVenues\(\)/);
  assert.match(source.createHub, /\/workspace\/item-authoring\$\{venueId \? `\?venueId=/);
  assert.match(source.createHub, /this\.context\?\.type === "organization"/);
});

test("l'item editor riusa il physical intent esistente, non duplica l'inventario e ricarica il contesto autorevole", () => {
  assert.match(source.item, /Destinato all’esposizione/);
  assert.match(source.item, /createItemWithPhysicalIntent\(this\.venueId/);
  assert.match(source.item, /!this\.venueInventoryMatch/);
  assert.match(source.item, /Già nell’inventario della sede/);
  assert.match(source.item, /this\.venueTargetContext = await authoringRepository\.venueTargetContext\(this\.venueTargetId\)/);
  assert.match(source.item, /this\.venueInventoryMatch = null/);
});

test("l'inventario authoring legge tutti i VenueTarget attivi sulla configurazione effettiva", () => {
  assert.match(source.venueAuthoringTargets, /permissionCode: "venue\.view"/);
  assert.match(source.venueAuthoringTargets, /VenueTarget\.find\(\{ venueId: venue\._id, lifecycleStatus: "active" \}\)/);
  assert.match(source.venueAuthoringTargets, /view: "effective"/);
  assert.match(source.venueAuthoringTargets, /status: "unplaced"/);
  assert.match(source.venueAuthoringTargets, /inventoryRank/);
  assert.match(source.venueChooser, /exposed: "Esposta", unplaced: "Da collocare", unavailable: "Non disponibile"/);
  assert.match(source.venueChooser, /indipendentemente dal fatto che l’entità sia esposta, da collocare o temporaneamente non disponibile/);
});

test("creazione contenuti e modifica fisica sono capability indipendenti", () => {
  assert.match(source.venueAuthoringTargets, /canCreateContent: authority\.effectivePermissions\.includes\("item\.create"\)/);
  assert.match(source.venueAuthoringTargets, /canEditInventory: authority\.effectivePermissions\.includes\("venue\.physical\.edit"\)/);
  assert.match(source.venueChooser, /const canCreateContent = Boolean\(this\.data\?\.permissions\?\.canCreateContent\)/);
  assert.match(source.venueChooser, /Sola consultazione/);
  assert.match(source.managementRepository, /authoringPermissions: authoring\.permissions \|\| \{\}/);
  assert.match(source.venueEditorTargets, /canCreateContent = false/);
  assert.match(source.venueEditorTargets, /const createContent = canCreateContent/);
  assert.match(source.venueEditorSlots, /this\.data\.authoringPermissions\?\.canCreateContent/);
  assert.match(source.venueEditorSlots, /const physicalActions = editable/);
  assert.match(source.venueEditorSlots, /const contentAction = canCreateContent/);
});

test("l'inventario fisico resta scoped alla Venue", () => {
  assert.match(source.venueTargetModel, /venueId: \{ type: Schema\.Types\.ObjectId, ref: "Venue", required: true/);
  assert.match(source.venueTargetModel, /\{ venueId: 1, subjectId: 1 \}/);
  assert.match(source.venueTargetModel, /unique_active_venue_subject/);
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
    "artaround-context-release-composer",
    "artaround-commerce-management-view",
  ]) assert.match(source.formGuard, new RegExp(host));
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
