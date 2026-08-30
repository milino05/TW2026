const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { validateNamespaceRevisionSnapshot } = require("../services/validation/namespace.validation");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/namespace-editor-view.js");
const stylePath = path.join(root, "clients/marketplace/src/styles/namespace-editor.css");
const starterPath = path.join(root, "clients/marketplace/src/application/namespace-editor-starter.js");
const namespaceServicePath = path.join(root, "services/namespaceRevision.service.js");
const namespaceControllerPath = path.join(root, "controllers/namespaces.controller.js");
const source = fs.readFileSync(viewPath, "utf8");
const styleSource = fs.readFileSync(stylePath, "utf8");
const starterSource = fs.readFileSync(starterPath, "utf8");
const namespaceServiceSource = fs.readFileSync(namespaceServicePath, "utf8");
const namespaceControllerSource = fs.readFileSync(namespaceControllerPath, "utf8");

test("Regole editoriali passano il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", viewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Namespace editor espone le otto sezioni user-facing approvate", () => {
  for (const label of ["Generale", "Durate", "Livelli di linguaggio", "Tipi di soggetto", "Relazioni", "Presentazione", "Selezione", "Mapping esterni"]) assert.match(source, new RegExp(label));
});

test("Namespace editor mostra una sezione alla volta con tab accessibili e deep link", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /data-namespace-section/);
  assert.match(source, /panel\.hidden = !selected/);
  assert.match(source, /#namespace-\$\{section\}/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /this\.syncSectionNavigation\(\)/);
  assert.match(styleSource, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styleSource, /namespace-editor-nav nav\{display:flex;overflow:auto\}/);
});

test("progressive disclosure preserva i campi tecnici e il modello NamespaceRevision", () => {
  for (const token of ["definitionId", "key", "domainDefinitionIds", "rangeDefinitionIds", "category", "strength", "directionality", "userIntents", "reverseLabel", "allowMultiple", "targetRequired"]) assert.match(source, new RegExp(token));
  assert.match(source, /updateNamespaceRevision/);
  assert.doesNotMatch(source, /venueId|venueTargetId|recognitionMedia/);
});

test("le definizioni non selezionate restano compatte e una sola entra in modifica", () => {
  assert.match(source, /editingDefinitionKey/);
  assert.match(source, /data-edit-definition/);
  assert.match(source, /namespace-definition--collapsed/);
  assert.match(source, /namespace-definition-summary/);
  assert.match(source, /role="button" tabindex="0" aria-expanded="false"/);
  assert.match(source, /\["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(source, /this\.editingDefinitionKey = key/);
  assert.doesNotMatch(source, /Riduci/);
  assert.match(source, /this\.editingDefinitionKey = definitionKey\(field, definition/);
  assert.match(styleSource, /namespace-definition-editor\[hidden\]\{display:none\}/);
  assert.match(styleSource, /namespace-definition--collapsed:hover/);
});

test("Mapping esterni usa semanticRefs esistenti e resta provider-neutral", () => {
  assert.match(source, /semanticRefs/);
  assert.match(source, /semantic-ref-selected/);
  assert.match(source, /mode="mapping"/);
  assert.match(source, /schema\|ID\|relazione/);
  assert.match(source, /exact, close, broader, narrower/);
});

test("il controllo finale è l'unica azione editoriale e non pubblica direttamente", () => {
  assert.match(source, /namespace\.revision\.check/);
  assert.doesNotMatch(source, /namespace\.revision\.publish/);
  assert.doesNotMatch(source, /namespace\.revision\.request_review/);
  assert.match(source, /availableOperations/);
  assert.doesNotMatch(source, /window\.confirm|window\.prompt/);
  assert.match(source, /Controlla se è tutto pronto/);
  assert.match(source, /Salva e controlla/);
});

test("un controllo riuscito rende le regole private e propone il Marketplace", () => {
  assert.match(source, /privateSuccessOpen/);
  assert.match(source, /result\?\.finalized/);
  assert.match(source, /Le regole editoriali sono corrette e ora sono private/);
  assert.match(source, /Configura offerta e pubblica/);
  assert.match(source, /Mantieni privata/);
  assert.match(source, /resourceType=namespace/);
  assert.match(source, /data-close-private-success/);
  assert.match(styleSource, /namespace-private-success-overlay/);
  assert.match(styleSource, /html\.namespace-overlay-open,body\.namespace-overlay-open\{overflow:hidden!important/);
});

test("il backend consolida come privata soltanto una revisione senza problemi bloccanti", () => {
  assert.match(namespaceControllerSource, /checkNamespaceConsistency/);
  assert.match(namespaceServiceSource, /async function checkNamespaceConsistency/);
  assert.match(namespaceServiceSource, /finalized: false, visibility: "draft"/);
  assert.match(namespaceServiceSource, /publishWithoutReview\(revision, actorUserId\)/);
  assert.match(namespaceServiceSource, /publishedRevisionId: revision\._id, workingRevisionId: null/);
  assert.match(namespaceServiceSource, /finalized: true, visibility: "private"/);
});

test("dirty state impedisce perdita silenziosa e salva metadata più definizioni insieme", () => {
  assert.match(source, /beforeunload/);
  assert.match(source, /data-dirty-indicator/);
  assert.match(source, /saveAll/);
  assert.match(source, /updateNamespace\(this\.id, metadata\)/);
  assert.match(source, /updateNamespaceRevision\(this\.id, definitions\)/);
  assert.match(source, /data-confirm-leave/);
  assert.match(source, /if \(add\)[\s\S]*?snapshotDraft\(\)/);
  assert.match(source, /if \(remove\)[\s\S]*?snapshotDraft\(\)/);
});

test("ritorno all owner mantiene Account e Organization nelle aree corrette", () => {
  assert.match(source, /section=rules/);
  assert.match(source, /\/profile#account-rules/);
});

test("più durate ricevono valori distinti e vengono salvate in ordine", () => {
  assert.match(source, /function emptyDefinition\(field, existing = \[\]\)/);
  assert.match(source, /const longest = Math\.max\(0, \.\.\.existing\.map/);
  assert.match(source, /base\.targetSeconds = longest \? longest \+ 60 : 60/);
  assert.match(source, /output\[field\]\.sort\(\(left, right\) => left\.targetSeconds - right\.targetSeconds\)/);
  assert.match(source, /emptyDefinition\(field, definitions\[field\]\)/);
});

test("gli errori portano alla sezione da correggere con messaggi comprensibili", () => {
  assert.match(source, /userFacingFieldLabel, userFacingIssueMessage/);
  assert.match(source, /error\?\.details\?\.find/);
  assert.match(source, /if \(section\) this\.activeSection = section/);
  assert.match(source, /Problemi da risolvere/);
});

test("ogni sezione spiega scopo, domanda, esempio e significato dei campi", () => {
  for (const question of [
    "Quanto tempo deve richiedere la lettura?",
    "Quanto deve essere semplice o specialistico il testo?",
    "Di quali tipi di soggetto parleranno i contenuti?",
    "Come sono collegati tra loro i soggetti?",
    "Come deve essere organizzato e presentato il testo?",
  ]) assert.match(source, new RegExp(question.replace(/[?]/g, "\\?")));
  assert.match(source, /namespace-guidance/);
  assert.match(source, /namespace-help/);
  assert.match(source, /data-tooltip/);
  assert.match(source, /Tempo di lettura in secondi/);
  assert.match(styleSource, /namespace-help::after/);
});

test("tutorial facoltativo parte solo al primo accesso e resta sempre ripetibile", () => {
  assert.match(source, /artaround\.namespace-editor\.tutorial\.v1/);
  assert.match(source, /shouldStartTutorial/);
  assert.match(source, /localStorage\.getItem\(TUTORIAL_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(TUTORIAL_STORAGE_KEY, "seen"\)/);
  assert.match(source, /data-start-tutorial/);
  assert.match(source, /Ripeti tutorial/);
  assert.match(source, /data-tutorial-previous/);
  assert.match(source, /data-tutorial-next/);
  assert.match(source, /aria-modal="true"/);
  assert.match(styleSource, /namespace-tutorial-spotlight/);
  assert.match(styleSource, /namespace-tutorial-bubble/);
  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*?this\.placeTutorial\(target\)/);
  assert.match(source, /onTutorialScroll[\s\S]*?event\.preventDefault/);
  assert.match(source, /syncOverlayLock/);
  assert.match(styleSource, /html\.namespace-overlay-open,body\.namespace-overlay-open\{overflow:hidden!important/);
  assert.match(styleSource, /namespace-tutorial-overlay\[data-centered="true"\][^{]*\{[^}]*background:rgba/);
});

test("modello guidato è facoltativo, non distruttivo e completo", () => {
  for (const token of [
    "Creata da",
    "chi è l'autore",
    "Contesto storico e culturale",
    "Quando e dove è stata realizzata?",
    "periodo storico, al luogo, al movimento artistico e alle condizioni geopolitiche",
    "Tecnica e esecuzione",
    "Quali materiali e tecniche sono stati impiegati?",
  ]) assert.match(starterSource, new RegExp(token.replace(/[?]/g, "\\?"), "i"));
  assert.match(source, /data-open-starter-template/);
  assert.match(source, /data-apply-starter-template/);
  assert.match(source, /Il modello preserva le definizioni che hai inserito/);
  assert.match(starterSource, /if \(existing\) return existing/);
  assert.match(starterSource, /definitions\.durationTypes\.sort/);
  assert.match(starterSource, /legacyPresentationKeys/);
  assert.match(source, /updateNamespaceRevision\(this\.id, prepared\)/);
});

test("modello guidato produce una revisione valida e preserva le definizioni esistenti", async () => {
  const { starterDefinitions } = await import(pathToFileURL(starterPath).href);
  const existingDuration = {
    definitionId: "00000000-0000-4000-8000-000000000001",
    key: "lettura-personalizzata",
    label: "Lettura personalizzata",
    description: "Una durata già scelta dall'utente.",
    semanticRefs: [],
    targetSeconds: 120,
  };
  const definitions = starterDefinitions({ durationTypes: [existingDuration] });
  assert.deepEqual(validateNamespaceRevisionSnapshot(definitions), []);
  assert.deepEqual(definitions.durationTypes.find((entry) => entry.definitionId === existingDuration.definitionId), existingDuration);
  assert.deepEqual(definitions.durationTypes.map((entry) => entry.targetSeconds), [60, 120, 180, 360]);
  assert.deepEqual(definitions.relationTypes.map((entry) => entry.label), ["Creata da", "Contesto storico e culturale", "Tecnica e esecuzione"]);
  assert.equal(definitions.presentationAspects.length, 0);
  assert.equal(definitions.relationTypes[0].domainDefinitionIds[0], definitions.subjectClasses[0].definitionId);
  assert.equal(definitions.relationTypes[0].rangeDefinitionIds[0], definitions.subjectClasses[1].definitionId);
  assert.equal(definitions.relationTypes[1].rangeDefinitionIds[0], definitions.subjectClasses[2].definitionId);
  assert.equal(definitions.relationTypes[2].rangeDefinitionIds[0], definitions.subjectClasses[3].definitionId);
});

test("riapplicare il modello migra solo le due presentazioni legacy in relazioni", async () => {
  const { starterDefinitions } = await import(pathToFileURL(starterPath).href);
  const legacyAspect = {
    definitionId: "00000000-0000-4000-8000-000000000010",
    key: "contesto-storico-culturale",
    label: "Contesto storico e culturale",
    description: "Voce del vecchio modello.",
    semanticRefs: [],
  };
  const customAspect = {
    definitionId: "00000000-0000-4000-8000-000000000011",
    key: "apertura-personalizzata",
    label: "Apertura personalizzata",
    description: "Voce creata dall'utente.",
    semanticRefs: [],
  };
  const definitions = starterDefinitions({ presentationAspects: [legacyAspect, customAspect] });
  assert.deepEqual(validateNamespaceRevisionSnapshot(definitions), []);
  assert.deepEqual(definitions.presentationAspects, [customAspect]);
  assert.ok(definitions.relationTypes.some((entry) => entry.key === legacyAspect.key));
});
