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

test("item authoring espone cinque passaggi includendo i collegamenti facoltativi", () => {
  for (const label of ["Di cosa parla", "Informazioni generali", "Regole e testi", "Collegamenti", "Controllo finale"]) {
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
  assert.match(source, /authoring-progress ol\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\);min-width:0\}/);
  assert.match(source, /authoring-progress button strong\{display:none\}/);
  assert.doesNotMatch(source, /authoring-progress\{overflow:auto/);
});

test("la bozza richiede i dati essenziali ma può essere salvata senza testi", () => {
  assert.match(source, /generalDetailsReady\(\)/);
  assert.match(source, /contentDraftReady\(\)/);
  assert.match(source, /const fieldsReady = \[this\.draft\.label, this\.draft\.license\]/);
  assert.match(source, /const rulesReady = !this\.newEditionMode/);
  assert.match(source, /const textsReady = this\.draft\.representations\.every/);
  assert.doesNotMatch(source, /const textsReady = this\.draft\.representations\.length > 0/);
  assert.match(source, /if \(step === 4\) return Boolean\(this\.selectedRevision\(\) && !this\.newEditionMode\)/);
  assert.match(source, /if \(step === 5\) return Boolean\(this\.selectedRevision\(\) && !this\.newEditionMode\)/);
});

test("titolo, licenza e immagine precedono regole editoriali e testi", () => {
  const stepTwo = source.match(/renderStepTwo\(\) \{([\s\S]*?)\n  \}\n\n  renderStepThree/)?.[1] || "";
  const stepThree = source.match(/renderStepThree\(\) \{([\s\S]*?)\n  \}\n\n  renderMemberships/)?.[1] || "";
  assert.match(stepTwo, /data-content-details/);
  assert.match(stepTwo, /Titolo del contenuto/);
  assert.match(stepTwo, /<label>Licenza/);
  assert.match(stepTwo, /this\.renderMediaCard/);
  assert.doesNotMatch(stepTwo, /this\.renderNamespaceSelector\(\)/);
  assert.doesNotMatch(stepTwo, /this\.renderRepresentationEditors\(controls\)/);
  assert.match(stepThree, /this\.renderNamespaceSelector\(\)/);
  assert.match(stepThree, /this\.renderRepresentationEditors\(controls\)/);
  assert.match(source, /field: "durationTypeDefinitionId", label: "Durata"/);
  assert.match(source, /field: "languageLevelDefinitionId", label: "Livello di linguaggio"/);
  assert.doesNotMatch(source, /data-personalization-draft/);
});

test("la nuova versione editoriale viene materializzata salvando testi e impostazioni", () => {
  assert.match(source, /form\.matches\("\[data-content-draft\]"\)/);
  assert.match(source, /this\.activeStep = 4/);
  assert.match(source, /if \(this\.newEditionMode\) await this\.createEditionFromDraft\(\)/);
  assert.match(source, /authoringRepository\.createEdition\(this\.itemId/);
});

test("lo step collegamenti parte vuoto, ricerca il target e usa le relazioni delle regole", () => {
  assert.match(source, /<span class="step-number">4<\/span>/);
  assert.match(source, /Non hai ancora aggiunto nessun collegamento/);
  assert.match(source, /data-add-connection/);
  assert.match(source, /data-connection-search/);
  assert.match(source, /data-connection-target-id/);
  assert.match(source, /name="relationTypeDefinitionId" data-connection-relation/);
  assert.match(source, /name="weight" type="number" min="0" max="10"/);
  assert.match(source, /name="provenanceOrigin"/);
  assert.match(source, /name="note"/);
  assert.match(source, /authoringRepository\.createItemConnection/);
  assert.match(source, /authoringRepository\.removeItemConnection/);
  assert.match(source, /I collegamenti sono facoltativi/);
});

test("il controllo finale resta backend-authoritative ed è l'unica azione editoriale", () => {
  assert.match(source, /this\.workflowOperations\(\)/);
  assert.match(source, /this\.availableOperation\(operationCode\)/);
  assert.match(source, /data-workflow-form/);
  assert.match(source, /operation\.code === "workflow\.check"/);
  assert.match(source, /operationCode !== "workflow\.check"/);
  assert.match(source, /Controlla se è tutto pronto/);
  assert.doesNotMatch(source, /workflow\.publish/);
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
  assert.match(source, /representations: \[\]/);
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
  assert.match(source, /activeRepresentationIndex = null/);
  assert.match(source, /data-selected="true"/);
  assert.match(source, /data-collapsed-text="\$\{index\}"/);
  assert.match(source, /data-select-text="\$\{index\}"/);
  assert.match(source, /class="representation-summary"/);
  for (const label of ["Durata", "Livello di linguaggio", "Lingua", "Modifica"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /this\.activeRepresentationIndex = this\.draft\.representations\.length - 1/);
  assert.match(source, /this\.activeRepresentationIndex = null/);
  assert.match(source, /Completa durata, livello di linguaggio, lingua e testo/);
  assert.match(source, /representation-editor--collapsed\{[^}]*cursor:pointer/);
  assert.match(source, /representation-summary\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(source, /authoring-page\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(source, /authoring-page>\*,\.wizard-step,\.editor-form,\.representation-list,\.representation-editor\{min-width:0\}/);
});

test("durata e linguaggio usano menu interni affidabili al singolo click", () => {
  assert.match(source, /const choiceMenu = \(\{ index, field, label, selected, placeholder, options \}\)/);
  assert.match(source, /<details name="representation-choice" data-representation-choice-menu=/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option" aria-selected=/);
  assert.match(source, /button\[data-representation-choice\]/);
  assert.match(source, /representation\[field\] = representationChoice\.dataset\.value/);
  assert.match(source, /input type="hidden" name="\$\{field\}" data-representation-index=/);
  assert.doesNotMatch(source, /select name="durationTypeDefinitionId"/);
  assert.doesNotMatch(source, /select name="languageLevelDefinitionId"/);
});

test("il refresh ripristina informazioni, regole editoriali e bozza degli step due e tre", () => {
  assert.match(source, /workingDraftStorageKey\(\)/);
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /window\.sessionStorage\.getItem/);
  assert.match(source, /async restoreWorkingDraft\(\)/);
  assert.match(source, /const restored = await this\.restoreWorkingDraft\(\)/);
  assert.match(source, /if \(this\.selectedRevision\(\)\) this\.activeStep = 5;\s*else await this\.prepareNewEdition\(\)/);
  assert.match(source, /!\[2, 3\]\.includes\(this\.activeStep\)/);
  assert.match(source, /activeStep: this\.activeStep/);
  assert.match(source, /Number\(stored\.activeStep\) === 3 && this\.generalDetailsReady\(\) \? 3 : 2/);
  assert.match(source, /namespaceStillAvailable/);
  assert.match(source, /await this\.selectNamespace\(selectedNamespaceId\)/);
  assert.match(source, /Bozza ripristinata dopo l'aggiornamento della pagina/);
  assert.match(source, /this\.clearWorkingDraft\(\);\s*this\.newEditionMode = false/);
  assert.match(source, /this\.clearWorkingDraft\(\);\s*await this\.reloadProjection\(editionId\)/);
});

test("lo stato senza testi è esplicito e l'ultimo testo può essere rimosso", () => {
  assert.match(source, /Non hai ancora aggiunto nessun testo/);
  assert.match(source, /Puoi salvare la bozza anche così/);
  assert.match(source, /Per superare il controllo dovrai aggiungere almeno un testo completo/);
  assert.match(source, /if \(this\.draft\.representations\[index\]\)/);
  assert.doesNotMatch(source, /this\.draft\.representations\.length > 1 && this\.draft\.representations\[index\]/);
  assert.match(source, /if \(!variant\.representations\.length\) payload\.defaultPresentation = null/);
  assert.match(source, /review-texts--empty/);
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
  assert.match(source, /relatedSubjectIds: \[\]/);
  assert.match(source, /tags: \[\]/);
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

test("il controllo rende il contenuto privato e propone il Marketplace in un dialog separato", () => {
  assert.match(source, /privateSuccessOpen/);
  assert.match(source, /result\?\.result\?\.finalized/);
  assert.match(source, /Il contenuto è corretto e ora è privato/);
  assert.match(source, /Configura offerta e pubblica/);
  assert.match(source, /Mantieni privato/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /resourceType=item_edition/);
  assert.match(source, /html:has\(\.private-success-overlay\)/);
});

test("il flusso da oggetto fisico preserva la separazione del dominio", () => {
  assert.match(source, /L'oggetto serve a precompilare il soggetto/);
  assert.match(source, /non incorpora la posizione fisica/);
  assert.match(source, /immagine\/i restano nella configurazione della sede/);
});

test("l'immagine facoltativa è proposta, modificabile e salvata con la revisione", () => {
  assert.match(source, /loadSuggestedMedia/);
  assert.match(source, /includeMedia: true/);
  assert.match(source, /Immagine del contenuto · facoltativa/);
  assert.match(source, /Proponi da Wikidata/);
  assert.match(source, /data-change-media/);
  assert.match(source, /data-remove-media/);
  assert.match(source, /data-media-upload/);
  assert.match(source, /ottimizzati automaticamente/);
  assert.match(source, /optimizedMediaFile/);
  assert.match(source, /illustrativeMedia: this\.draft\.illustrativeMedia/);
  assert.match(source, /payload\.illustrativeMedia = this\.draft\.illustrativeMedia/);
  assert.match(source, /renderReviewMedia\(\)/);
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
