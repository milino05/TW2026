const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const organizationPath = path.join(root, "clients/marketplace/src/ui/organization-view.js");
const dialogPath = path.join(root, "clients/marketplace/src/ui/venue-create-dialog.js");
const taskDialogPath = path.join(root, "clients/marketplace/src/ui/task-dialog.js");
const repositoryPath = path.join(root, "clients/marketplace/src/infrastructure/http/venue-creation-repository.js");
const stylesPath = path.join(root, "clients/marketplace/src/styles/venue-create.css");
const indexPath = path.join(root, "clients/marketplace/index.html");
const organization = fs.readFileSync(organizationPath, "utf8");
const dialog = fs.readFileSync(dialogPath, "utf8");
const taskDialog = fs.readFileSync(taskDialogPath, "utf8");
const repository = fs.readFileSync(repositoryPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

test("la sezione Sedi apre un task modal e non usa più il form inline", () => {
  assert.match(organization, /artaround-venue-create-dialog/);
  assert.match(organization, /venue-section-actions/);
  assert.doesNotMatch(organization, /data-create-venue/);
  assert.doesNotMatch(organization, /<details class="account-create"><summary>[^<]*.*Nuova sede/);
});

test("la creazione Sede usa la shell condivisa in due passaggi", () => {
  assert.match(dialog, /createTaskDialog/);
  assert.match(dialog, /size: "large"/);
  assert.match(dialog, /renderBody: \(\) => this\.renderBody\(\)/);
  assert.match(dialog, /renderFooter: \(\) => this\.renderFooter\(\)/);
  assert.match(dialog, /isDirty: \(\) => this\.dirty/);
  assert.match(taskDialog, /mountModalInteraction/);
  assert.match(dialog, /Passaggio 1 di 2/);
  assert.match(dialog, /Passaggio 2 di 2/);
  assert.match(dialog, /venue-create-stepper/);
  assert.match(dialog, /name="physicalVocabularyRevisionId"/);
  assert.match(dialog, /Gestisci vocabolari fisici/);
  assert.match(dialog, /data-venue-create-back/);
  assert.doesNotMatch(dialog, /context-task-modal|data-venue-create-backdrop/);
});

test("il modal seleziona soltanto vocabolari esistenti e apre poi l'editor della Sede", () => {
  assert.match(dialog, /this\.preflight\?\.choices/);
  assert.match(dialog, /physicalVocabularyRevisionId: this\.selectedRevisionId/);
  assert.doesNotMatch(dialog, /mode:\s*["']starter["']/);
  assert.doesNotMatch(dialog, /mode:\s*["']blank["']/);
  assert.doesNotMatch(dialog, /createPhysicalVocabulary/);
  assert.match(dialog, /\/venues\/editor\?venueId=/);
});

test("la repository usa preflight e comando configurato dedicati", () => {
  assert.match(repository, /\/venues\/creation-preflight/);
  assert.match(repository, /\/venues\/configured/);
  assert.doesNotMatch(repository, /physical-onboarding/);
});

test("gli stili dedicati sono caricati e mantengono il layout a due passaggi", () => {
  assert.match(index, /venue-create\.css/);
  assert.match(styles, /\.venue-create-modal/);
  assert.match(styles, /\.venue-create-stepper\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:52rem\)/);
  assert.match(styles, /@media\(max-width:36rem\)/);
});

test("le view coinvolte passano il syntax gate", () => {
  for (const sourcePath of [organizationPath, dialogPath, taskDialogPath, repositoryPath]) {
    const result = spawnSync(process.execPath, ["--check", sourcePath], { encoding: "utf8" });
    assert.equal(result.status, 0, `${sourcePath}: ${result.stderr || result.stdout}`);
  }
});
