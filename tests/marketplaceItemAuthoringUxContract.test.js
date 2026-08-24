const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const itemPath = path.join(root, "clients/marketplace/src/ui/item-authoring-view.js");
const pickerPath = path.join(root, "clients/marketplace/src/ui/semantic-entity-picker.js");
const source = fs.readFileSync(itemPath, "utf8");
const pickerSource = fs.readFileSync(pickerPath, "utf8");

test("item authoring e picker semantico passano il syntax gate", () => {
  for (const target of [itemPath, pickerPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("item authoring espone i quattro passaggi novice-first approvati", () => {
  for (const label of ["Di cosa parla", "Contenuto", "Personalizzazione", "Controllo e pubblicazione"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /aria-label="Passaggi di creazione"/);
  assert.match(source, /aria-current="\$\{current \? "step" : "false"\}"/);
  assert.doesNotMatch(source, /<h2>Edition e Namespace<\/h2>/);
  assert.doesNotMatch(source, /<h2>Revision e Representation<\/h2>/);
});

test("il wizard non permette di saltare la compilazione del contenuto essenziale", () => {
  assert.match(source, /contentDraftReady\(\)/);
  assert.match(source, /const fieldsReady = \[this\.draft\.label, this\.draft\.author, this\.draft\.license, this\.draft\.text\]/);
  assert.match(source, /const namespaceReady = !this\.newEditionMode \|\| Boolean\(this\.draft\.namespaceId && this\.namespaceControls\)/);
  assert.match(source, /if \(step === 3\) return Boolean\(this\.itemId && this\.contentDraftReady\(\)\)/);
});

test("la nuova Edition viene materializzata solo dopo la personalizzazione", () => {
  assert.match(source, /form\.matches\("\[data-content-draft\]"\)/);
  assert.match(source, /this\.activeStep = 3/);
  assert.match(source, /form\.matches\("\[data-personalization-draft\]"\)/);
  assert.match(source, /if \(this\.newEditionMode\) await this\.createEditionFromDraft\(\)/);
  assert.match(source, /authoringRepository\.createEdition\(this\.itemId/);
});

test("il workflow resta backend-authoritative e non usa prompt nativi", () => {
  assert.match(source, /this\.workflowOperations\(\)/);
  assert.match(source, /this\.availableOperation\(operationCode\)/);
  assert.match(source, /data-workflow-form/);
  assert.match(source, /name="message"/);
  assert.match(source, /Controlla se è tutto pronto/);
  assert.doesNotMatch(source, /window\.prompt\(/);
});

test("feature parity mantiene versioni, spazi editoriali e dettagli tecnici", () => {
  assert.match(source, /data-new-edition/);
  assert.match(source, /data-edition-id/);
  assert.match(source, /data-content-space-id/);
  assert.match(source, /authoringRepository\.setContentSpaceMembership/);
  for (const technicalTerm of ["ItemEdition", "ItemRevision", "NamespaceRevision", "PresentationVariant", "Representation"]) {
    assert.match(source, new RegExp(technicalTerm));
  }
  assert.match(source, /<summary>Dettagli tecnici<\/summary>/);
});

test("testi multipli usano le Representation esistenti senza un modello parallelo", () => {
  assert.match(source, /async addRepresentation\(data\)/);
  assert.match(source, /async updateRepresentation\(data\)/);
  assert.match(source, /data-add-representation/);
  assert.match(source, /data-update-representation/);
  assert.match(source, /variant\.representations\.push\(/);
  assert.match(source, /Aggiungi un altro testo/);
  assert.match(source, /Altri testi e livelli/);
  assert.match(source, /authoringRepository\.updateEdition\(editionId, payload\)/);
});

test("i metadati facoltativi conservano i tag della revisione", () => {
  assert.match(source, /function parseTags\(value\)/);
  assert.match(source, /name="tags"/);
  assert.match(source, /tags: parseTags\(this\.draft\.tags\)/);
  assert.match(source, /payload\.tags = parseTags\(this\.draft\.tags\)/);
});

test("pubblicazione editoriale e catalogo restano lifecycle distinti", () => {
  assert.match(source, /La pubblicazione editoriale non crea automaticamente una scheda nel Marketplace/);
  assert.match(source, /La pubblicazione nel Catalogo è un passaggio commerciale separato/);
});

test("il flusso da oggetto fisico preserva la separazione del dominio", () => {
  assert.match(source, /L'oggetto serve a precompilare il soggetto/);
  assert.match(source, /non incorpora la posizione fisica/);
  assert.match(source, /immagine\/i restano nella configurazione della sede/);
});

test("il picker subject usa microcopy novice-first senza cambiare il contratto Subject", () => {
  assert.match(pickerSource, /Cerca ciò di cui vuoi parlare/);
  assert.match(pickerSource, /Trova o crea il soggetto corretto/);
  assert.match(pickerSource, /subject-selected/);
  assert.match(pickerSource, /searchSubjectCascade/);
  assert.doesNotMatch(pickerSource, /Cerca il Subject/);
  assert.doesNotMatch(pickerSource, /Trova o crea il Subject corretto/);
});