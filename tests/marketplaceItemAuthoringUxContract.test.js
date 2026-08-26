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

test("item authoring espone tre passaggi senza separare contenuto e personalizzazione", () => {
  for (const label of ["Di cosa parla", "Testi e impostazioni", "Controllo e pubblicazione"]) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /<span class="eyebrow">Personalizzazione<\/span>/);
  assert.match(source, /aria-label="Passaggi di creazione"/);
  assert.match(source, /aria-current="\$\{current \? "step" : "false"\}"/);
  assert.doesNotMatch(source, /<h2>Edition e Namespace<\/h2>/);
  assert.doesNotMatch(source, /<h2>Revision e Representation<\/h2>/);
});

test("lo stepper mobile resta compatto e non richiede scorrimento orizzontale", () => {
  assert.match(source, /authoring-progress__summary/);
  assert.match(source, /Passaggio \$\{this\.activeStep\} di \$\{stages\.length\}/);
  assert.match(source, /aria-label="Passaggio \$\{step\}: \$\{escapeHtml\(label\)\}"/);
  assert.match(source, /authoring-progress ol\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);min-width:0\}/);
  assert.match(source, /authoring-progress button strong\{display:none\}/);
  assert.doesNotMatch(source, /authoring-progress\{overflow:auto/);
});

test("il wizard non permette di saltare la compilazione del contenuto essenziale", () => {
  assert.match(source, /contentDraftReady\(\)/);
  assert.match(source, /const fieldsReady = \[this\.draft\.label, this\.draft\.author, this\.draft\.license\]/);
  assert.match(source, /const rulesReady = !this\.newEditionMode/);
  assert.match(source, /const textsReady = this\.draft\.representations\.length > 0/);
  assert.match(source, /if \(step === 3\) return Boolean\(this\.selectedRevision\(\) && !this\.newEditionMode\)/);
});

test("le regole editoriali vengono scelte nello stesso step dei testi", () => {
  const stepTwo = source.match(/renderStepTwo\(\) \{([\s\S]*?)\n  \}\n\n  renderMemberships/)?.[1] || "";
  assert.match(stepTwo, /this\.renderNamespaceSelector\(\)/);
  assert.match(stepTwo, /this\.renderRepresentationEditors\(controls\)/);
  assert.match(source, /<label>Durata<select name="durationTypeDefinitionId"/);
  assert.match(source, /<label>Livello di linguaggio<select name="languageLevelDefinitionId"/);
  assert.doesNotMatch(source, /data-personalization-draft/);
});

test("la nuova versione editoriale viene materializzata salvando testi e impostazioni", () => {
  assert.match(source, /form\.matches\("\[data-content-draft\]"\)/);
  assert.match(source, /this\.activeStep = 3/);
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
  assert.match(source, /<summary>Identificativi tecnici<\/summary>/);
  assert.match(source, /Versione editoriale:/);
  assert.match(source, /gruppo di testi:/);
});

test("testi multipli vengono aggiunti e rimossi nella stessa bozza", () => {
  assert.match(source, /function newRepresentation\(overrides = \{\}\)/);
  assert.match(source, /representations: \[newRepresentation\(\)\]/);
  assert.match(source, /data-add-text/);
  assert.match(source, /data-remove-text/);
  assert.match(source, /this\.draft\.representations\.push\(newRepresentation\(\)\)/);
  assert.match(source, /this\.draft\.representations\.splice\(index, 1\)/);
  assert.match(source, /this\.draft\.representations\.map\(\(entry\) =>/);
  assert.match(source, /Aggiungi un altro testo/);
  assert.match(source, /Rimuovi/);
  assert.match(source, /authoringRepository\.updateEdition\(editionId, payload\)/);
});

test("solo il testo selezionato resta espanso mentre gli altri mostrano i dati essenziali", () => {
  assert.match(source, /activeRepresentationIndex = 0/);
  assert.match(source, /data-selected="true"/);
  assert.match(source, /data-collapsed-text="\$\{index\}"/);
  assert.match(source, /data-select-text="\$\{index\}"/);
  assert.match(source, /class="representation-summary"/);
  for (const label of ["Durata", "Livello di linguaggio", "Lingua", "Modifica"]) assert.match(source, new RegExp(label));
  assert.match(source, /this\.activeRepresentationIndex = this\.draft\.representations\.length - 1/);
  assert.match(source, /this\.activeRepresentationIndex = Math\.min\(index, this\.draft\.representations\.length - 1\)/);
  assert.match(source, /Completa durata, livello di linguaggio, lingua e testo/);
  assert.match(source, /representation-editor--collapsed\{[^}]*cursor:pointer/);
  assert.match(source, /representation-summary\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(source, /authoring-page\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(source, /authoring-page>\*,\.wizard-step,\.editor-form,\.representation-list,\.representation-editor\{min-width:0\}/);
});

test("il riepilogo separa visivamente etichette, valori e testi", () => {
  assert.match(source, /\.review-grid article\{display:grid;gap:\.35rem;padding:1rem/);
  assert.match(source, /\.review-texts article\{display:grid;gap:\.65rem;padding:1rem/);
  assert.match(source, /Testi configurati/);
  assert.match(source, /renderReviewTexts\(\)/);
});

test("i metadati facoltativi non sono esposti e i tag esistenti non vengono cancellati", () => {
  assert.doesNotMatch(source, /Metadati facoltativi/);
  assert.doesNotMatch(source, /name="tags"/);
  assert.match(source, /tags: revision\.tags \|\| \[\]/);
  assert.match(source, /relatedSubjectIds: \[\], tags: \[\]/);
  assert.doesNotMatch(source, /payload\.tags =/);
});

test("autore e area di lavoro non richiedono input ridondanti", () => {
  assert.doesNotMatch(source, /<label>Autore<input/);
  assert.match(source, /defaultAuthor\(\)/);
  assert.match(source, /Autore assegnato automaticamente/);
  assert.doesNotMatch(source, /class="working-context surface"/);
});

test("selezione soggetto e validazione hanno feedback italiano", () => {
  assert.match(source, /Soggetto selezionato · Continua/);
  assert.match(source, /this\.selectedSubject[\s\S]*?renderSubjectSummary\(\)[\s\S]*?: `<artaround-semantic-entity-picker/);
  assert.match(source, /Compila questo campo prima di continuare/);
  assert.match(source, /Seleziona un'opzione prima di continuare/);
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
  assert.match(pickerSource, /selected \? icon\("check"/);
  assert.doesNotMatch(pickerSource, /data-external-create|external-confirm|Crea da identità verificata/);
  assert.doesNotMatch(pickerSource, /Cerca il Subject/);
  assert.doesNotMatch(pickerSource, /Trova o crea il Subject corretto/);
});
