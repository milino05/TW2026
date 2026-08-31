const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const application = read("clients/marketplace/src/application/ui-feedback.js");
const primitives = read("clients/marketplace/src/ui/feedback-primitives.js");
const adapter = read("clients/marketplace/src/ui/transient-feedback-adapter.js");
const surfaceAdapter = read("clients/marketplace/src/ui/legacy-feedback-surface-adapter.js");
const styles = read("clients/marketplace/src/styles/feedback-primitives.css");
const main = read("clients/marketplace/src/main.js");
const index = read("clients/marketplace/index.html");
const router = read("clients/marketplace/src/application/router.js");
const docs = read("docs/ui-feedback-architecture.md");

test("i moduli del feedback condiviso superano il syntax check", () => {
  for (const relative of [
    "clients/marketplace/src/application/ui-feedback.js",
    "clients/marketplace/src/ui/feedback-primitives.js",
    "clients/marketplace/src/ui/transient-feedback-adapter.js",
    "clients/marketplace/src/ui/legacy-feedback-surface-adapter.js",
  ]) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});

test("surface e tone sono contratti separati", () => {
  for (const tone of ["neutral", "info", "success", "warning", "danger"]) assert.match(application, new RegExp(`"${tone}"`));
  for (const element of ["artaround-toast-center", "artaround-callout", "artaround-issue-panel", "artaround-field-feedback", "artaround-action-dialog", "artaround-status-indicator", "artaround-empty-state", "artaround-progress-state"]) assert.match(primitives, new RegExp(element));
  assert.match(docs, /surface/i);
  assert.match(docs, /tone/i);
});

test("le notifiche hanno durata predefinita di tre secondi e timer indipendenti", () => {
  assert.match(application, /DEFAULT_NOTIFICATION_DURATION = 3000/);
  assert.match(primitives, /timers = new Map\(\)/);
  assert.match(primitives, /this\.notifications\.push\(\{ \.\.\.incoming, state: "visible" \}\)/);
  assert.match(primitives, /setTimeout\(\(\) => this\.dismiss\(incoming\.id\), incoming\.duration\)/);
});

test("lo stack mantiene il FIFO visivo: i nuovi toast vengono aggiunti sotto", () => {
  const stackRule = styles.match(/\.artaround-toast-stack\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(stackRule, /flex-direction:column/);
  assert.doesNotMatch(stackRule, /column-reverse/);
  assert.match(styles, /artaround-toast-center\s*\{[\s\S]*position:fixed/);
});

test("l'action dialog implementa il comportamento modale riusabile", () => {
  assert.match(primitives, /role=\"dialog\" aria-modal=\"true\"/);
  assert.match(primitives, /event\.key === "Escape"/);
  assert.match(primitives, /event\.key !== "Tab"/);
  assert.match(primitives, /this\.returnFocus\?\.focus/);
  assert.match(primitives, /export function openActionDialog/);
});

test("le conferme semplici già classificate usano l'action dialog condiviso", () => {
  assert.match(surfaceAdapter, /showNamespaceLeaveDialog/);
  assert.match(surfaceAdapter, /showPhysicalConfirmationDialog/);
  assert.match(surfaceAdapter, /openActionDialog\(\{/);
  assert.match(surfaceAdapter, /tone: "danger"/);
  assert.match(surfaceAdapter, /data-confirm-leave/);
  assert.match(surfaceAdapter, /data-confirm-action/);
});

test("issue panel e callout inequivocabili vengono migrati alle primitive condivise", () => {
  assert.match(surfaceAdapter, /replaceElement\(legacy, "artaround-issue-panel", "warning"\)/);
  assert.match(surfaceAdapter, /replaceElement\(legacy, "artaround-callout", "warning"\)/);
  assert.match(surfaceAdapter, /\.namespace-workflow \.issues/);
  assert.match(surfaceAdapter, /physical-integrity--warning/);
  assert.match(surfaceAdapter, /blocker-panel/);
  assert.match(surfaceAdapter, /ItemAuthoringView/);
  assert.match(surfaceAdapter, /ArtAroundVisitAuthoringView/);
});

test("la migrazione converte solo canali transitori verificati", () => {
  assert.match(adapter, /ArtAroundNamespaceEditorView, "message"/);
  assert.match(adapter, /ArtAroundPhysicalVocabularyEditorView, "message"/);
  assert.match(adapter, /ArtAroundVisitAuthoringView, "message"/);
  assert.match(adapter, /ArtAroundVenueEditorView, "message"/);
  assert.match(adapter, /ItemAuthoringView, "notice"/);
  assert.doesNotMatch(adapter, /mediaNotice/);
  assert.doesNotMatch(adapter, /SemanticEntityPicker/);
  assert.match(adapter, /Persistent errors, busy states, search-result/);
});

test("il sistema globale viene caricato prima delle view", () => {
  assert.ok(main.indexOf('import "./ui/feedback-primitives.js"') < main.indexOf('import "./ui/app-shell.js"'));
  assert.ok(main.indexOf('import "./ui/transient-feedback-adapter.js"') < main.indexOf('import "./ui/app-shell.js"'));
  assert.ok(main.indexOf('import "./ui/legacy-feedback-surface-adapter.js"') < main.indexOf('import "./ui/app-shell.js"'));
  assert.match(index, /styles\/feedback-primitives\.css/);
});

test("il router non costruisce più notifiche DOM proprie", () => {
  assert.match(router, /import \{ notify \} from "\.\/ui-feedback\.js"/);
  assert.match(router, /notify\.success\(message\)/);
  assert.doesNotMatch(router, /dataRouteFeedback|data-route-feedback|createElement\("p"\)/);
});

test("la documentazione distingue tutte le surface approvate", () => {
  for (const heading of ["Toast / Notification", "Inline Callout", "Issue Panel", "Field Feedback", "Action Dialog", "Status Indicator", "Empty State", "Progress / Busy State"]) assert.match(docs, new RegExp(heading.replace("/", "\\/"), "i"));
  assert.match(docs, /Never migrate by searching for every `role="status"` or `role="alert"`/);
});
