const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const itemPath = path.join(root, "clients/marketplace/src/ui/item-authoring-view.js");
const pickerPath = path.join(root, "clients/marketplace/src/ui/semantic-entity-picker.js");
const presencePath = path.join(root, "clients/marketplace/src/ui/subject-presence.js");
const authoringRepositoryPath = path.join(root, "clients/marketplace/src/infrastructure/http/authoring-repository.js");
const source = fs.readFileSync(itemPath, "utf8");
const pickerSource = fs.readFileSync(pickerPath, "utf8");
const presenceSource = fs.readFileSync(presencePath, "utf8");
const authoringRepositorySource = fs.readFileSync(authoringRepositoryPath, "utf8");

test("item authoring, picker, presence e repository passano il syntax gate", () => {
  for (const target of [itemPath, pickerPath, presencePath, authoringRepositoryPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("l'Item Editor espone quattro passaggi e non contiene uno step relazioni", () => {
  for (const label of ["Di cosa parla", "Info generali", "Regole e testi", "Controllo"]) assert.match(source, new RegExp(label));
  assert.match(source, /const stages = \[\[1, "Di cosa parla"\], \[2, "Info generali"\], \[3, "Regole e testi"\], \[4, "Controllo"\]\]/);
  assert.match(source, /aria-label="Passaggi di creazione"/);
  assert.match(source, /Quattro passaggi: Subject, informazioni, versione editoriale e controllo/);
  assert.doesNotMatch(source, /data-add-connection|data-connection-search|createItemConnection|removeItemConnection/);
});

test("la creazione parte dal Subject e la presenza fisica resta informativa", () => {
  assert.match(source, /preselectedSubjectId = params\(\)\.get\("subjectId"\)/);
  assert.match(source, /authoringRepository\.getSubject\(this\.preselectedSubjectId\)/);
  assert.match(source, /<artaround-semantic-entity-picker mode="subject" entity-kind="item"><\/artaround-semantic-entity-picker>/);
  assert.match(source, /Crea Item e continua/);
  assert.match(source, /this\.renderSubjectPresence\(\)/);
  assert.match(source, /L'identità semantica è separata sia dalla versione editoriale sia dalla presenza fisica nelle Venue/);
  assert.match(presenceSource, /La presenza fisica è informativa e resta separata dal contenuto editoriale/);
  assert.doesNotMatch(source, /venueTargetId|physicalIntent|createItemWithPhysicalIntent|venueTargetContext/);
});

test("l'Item viene creato dal Subject e dal principal operativo senza side effect fisici", () => {
  assert.match(source, /authoringRepository\.createItem\(\{/);
  assert.match(source, /primarySubjectId: id\(this\.selectedSubject\)/);
  assert.match(source, /ownerType: this\.principal\.type/);
  assert.match(source, /ownerId: this\.principal\.id/);
  assert.match(authoringRepositorySource, /createItem\(\{ primarySubjectId, ownerType, ownerId, contentSpaceId \}\)/);
  assert.match(source, /contentSpaceId: this\.contextContentSpaceId/);
  assert.doesNotMatch(authoringRepositorySource, /createItemWithPhysicalIntent|venueTargetContext|venueTargets\(/);
});

test("titolo, licenza e immagine sono informazioni generali prima della versione editoriale", () => {
  assert.match(source, /data-content-details/);
  assert.match(source, /<label>Titolo<input name="label" required/);
  assert.match(source, /<label>Licenza<input name="license" required/);
  assert.match(source, /this\.renderMediaCard\(\)/);
  assert.match(source, /Immagine · facoltativa/);
  assert.match(source, /Autore: <strong>/);
  assert.match(source, /defaultAuthor\(\)/);
  assert.doesNotMatch(source, /<label>Autore<input/);
});

test("Namespace, segnali e testi appartengono alla ItemEdition", () => {
  assert.match(source, /Configura la versione editoriale/);
  assert.match(source, /this\.renderNamespaceSelector\(\)/);
  assert.match(source, /this\.renderSelectionSignals\(controls\)/);
  assert.match(source, /this\.renderRepresentationEditors\(controls\)/);
  assert.match(source, /authoringRepository\.createEdition\(this\.itemId/);
  assert.match(source, /authoringRepository\.updateEdition\(editionId, payload\)/);
  assert.match(source, /Durata, linguaggio e segnali appartengono alla versione sotto questo Namespace/);
  assert.match(source, /Le relazioni semantiche appartengono invece alla raccolta/);
});

test("testi multipli restano una proprietà della stessa revisione editoriale", () => {
  assert.match(source, /function newRepresentation\(overrides = \{\}\)/);
  assert.match(source, /representations: \[\]/);
  assert.match(source, /data-add-text/);
  assert.match(source, /data-remove-text/);
  assert.match(source, /this\.draft\.representations\.push\(newRepresentation\(\)\)/);
  assert.match(source, /this\.draft\.representations\.splice\(index, 1\)/);
  assert.match(source, /Completa durata, livello di linguaggio, lingua e testo/);
});

test("gli spazi editoriali includono l'Item senza cambiarne owner o semantica", () => {
  assert.match(source, /data-content-space-id/);
  assert.match(source, /authoringRepository\.setContentSpaceMembership/);
  assert.match(source, /Rende l'Item disponibile nello spazio senza cambiarne il proprietario/);
  assert.match(source, /La semantica della raccolta si gestisce nello Studio, non nell'Item Editor/);
});

test("la creazione avviata dalla Raccolta materializza Item e entry nel contesto corretto", () => {
  assert.match(source, /contextContentSpaceId = params\(\)\.get\("contentSpaceId"\)/);
  assert.match(source, /contextEditorialContextId = params\(\)\.get\("editorialContextId"\)/);
  assert.match(source, /contextNamespaceId = params\(\)\.get\("namespaceId"\)/);
  assert.match(source, /if \(!this\.contextContentSpaceId\) throw new Error/);
  assert.match(source, /contentSpaceId: this\.contextContentSpaceId/);
  assert.match(source, /id\(created\.edition\?\.namespaceId\) === id\(this\.contextNamespaceId\)/);
  assert.match(source, /editorialRepository\.addEntry\(this\.contextEditorialContextId/);
  assert.match(source, /Versione salvata e aggiunta alla raccolta/);
});

test("la bozza degli step di editing sopravvive al refresh senza introdurre un secondo stato di dominio", () => {
  assert.match(source, /workingDraftStorageKey\(\)/);
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /window\.sessionStorage\.getItem/);
  assert.match(source, /async restoreWorkingDraft\(\)/);
  assert.match(source, /!\[2, 3\]\.includes\(this\.activeStep\)/);
  assert.match(source, /Bozza ripristinata dopo l'aggiornamento della pagina/);
  assert.match(source, /this\.clearWorkingDraft\(\)/);
});

test("il controllo finale è backend-authoritative e rimanda la semantica allo Studio", () => {
  assert.match(source, /this\.workflowOperations\(\)/);
  assert.match(source, /operation\.code === "workflow\.check"/);
  assert.match(source, /operationCode !== "workflow\.check"/);
  assert.match(source, /Controlla se è tutto pronto/);
  assert.match(source, /Il grafo semantico non si modifica qui/);
  assert.match(source, /apri la sezione Relazioni dello Studio/);
  assert.doesNotMatch(source, /workflow\.publish/);
});

test("il picker semantico resta il boundary per identificare o creare Subject", () => {
  assert.match(pickerSource, /mode="subject"|mode/);
  assert.match(pickerSource, /subject-selected/);
  assert.match(pickerSource, /Wikidata|wikidata/);
});
