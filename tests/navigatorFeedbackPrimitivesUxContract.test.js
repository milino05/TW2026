const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const navigatorUi = path.join(root, "clients/navigator/src/ui");

function vueFiles() {
  return fs.readdirSync(navigatorUi)
    .filter((name) => name.endsWith(".vue"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(navigatorUi, name), "utf8") }));
}

const application = read("clients/navigator/src/application/uiFeedback.ts");
const app = read("clients/navigator/src/ui/App.vue");
const toastHost = read("clients/navigator/src/ui/FeedbackToastHost.vue");
const dialog = read("clients/navigator/src/ui/FeedbackActionDialog.vue");
const callout = read("clients/navigator/src/ui/FeedbackCallout.vue");
const issuePanel = read("clients/navigator/src/ui/FeedbackIssuePanel.vue");
const fieldFeedback = read("clients/navigator/src/ui/FeedbackFieldFeedback.vue");
const status = read("clients/navigator/src/ui/FeedbackStatusIndicator.vue");
const emptyState = read("clients/navigator/src/ui/FeedbackEmptyState.vue");
const progress = read("clients/navigator/src/ui/FeedbackProgressState.vue");
const adapter = read("clients/navigator/src/ui/NavigatorLegacyFeedbackAdapter.vue");
const theme = read("clients/navigator/src/ui/theme.css");
const login = read("clients/navigator/src/ui/LoginView.vue");
const generatedPlan = read("clients/navigator/src/ui/GeneratedPlanView.vue");
const library = read("clients/navigator/src/ui/LibraryView.vue");
const actionMenu = read("clients/navigator/src/ui/ActionMenu.vue");
const sessionActionSheet = read("clients/navigator/src/ui/SessionActionSheet.vue");
const synchronizedJoin = read("clients/navigator/src/ui/SynchronizedJoinView.vue");
const synchronizedSession = read("clients/navigator/src/ui/SynchronizedSessionView.vue");
const interactionLayers = read("clients/navigator/src/ui/interaction-layers.css");
const mapping = read("docs/ui-feedback-action-mapping.md");
const marketplaceAdapter = read("clients/marketplace/src/ui/transient-feedback-adapter.js");
const marketplaceStyles = read("clients/marketplace/src/styles/feedback-primitives.css");

function cssNumber(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : NaN;
}

test("Navigator espone lo stesso contratto tone del Marketplace", () => {
  assert.match(application, /DEFAULT_NOTIFICATION_DURATION = 3000/);
  for (const tone of ["neutral", "info", "success", "warning", "danger"]) assert.match(application, new RegExp(`"${tone}"`));
  assert.match(application, /artaround:notification/);
  assert.match(application, /artaround:notification:dismiss/);
});

test("il toast host Navigator è globale, FIFO e con timer indipendenti", () => {
  assert.match(toastHost, /<Teleport to="body">/);
  assert.match(toastHost, /notifications\.value\.push\(\{ \.\.\.detail \}\)/);
  assert.match(toastHost, /const timers = new Map/);
  assert.match(toastHost, /setTimeout\(\(\) => dismiss\(detail\.id\), detail\.duration\)/);
  assert.match(toastHost, /flex-direction: column/);
  assert.doesNotMatch(toastHost, /column-reverse/);
  assert.match(toastHost, /position: fixed/);
  assert.match(toastHost, /safe-area-inset-top/);
  assert.match(app, /<FeedbackToastHost \/>/);
});

test("lo stack Navigator anima entrata, uscita e riordino senza ricreare i toast", () => {
  assert.match(toastHost, /<TransitionGroup name="feedback-toast"/);
  assert.match(toastHost, /\.feedback-toast-enter-active/);
  assert.match(toastHost, /\.feedback-toast-leave-active/);
  assert.match(toastHost, /\.feedback-toast-move/);
  assert.doesNotMatch(toastHost, /data-state="entry\.state"/);
});

test("dialog e toast globali non possono essere coperti dalle normali schede dell'app", () => {
  const navigatorDialog = cssNumber(theme, "--artaround-layer-dialog");
  const navigatorToast = cssNumber(theme, "--artaround-layer-toast");
  const marketplaceDialog = cssNumber(marketplaceStyles, "--artaround-layer-dialog");
  const marketplaceToast = cssNumber(marketplaceStyles, "--artaround-layer-toast");
  for (const value of [navigatorDialog, navigatorToast, marketplaceDialog, marketplaceToast]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value > 2_000_000_000, `layer globale troppo basso: ${value}`);
  }
  assert.ok(navigatorToast > navigatorDialog);
  assert.ok(marketplaceToast > marketplaceDialog);
  assert.match(dialog, /<Teleport to="body">/);
  assert.match(dialog, /var\(--artaround-layer-dialog/);
  assert.match(toastHost, /var\(--artaround-layer-toast/);
});

test("drawer e popover Navigator stanno sotto feedback globale e fuori dai layout locali", () => {
  const popover = cssNumber(interactionLayers, "--artaround-layer-popover");
  const drawer = cssNumber(interactionLayers, "--artaround-layer-drawer");
  const modal = cssNumber(interactionLayers, "--artaround-layer-modal");
  const dialogLayer = cssNumber(theme, "--artaround-layer-dialog");
  assert.ok(popover < drawer && drawer < modal && modal < dialogLayer);
  assert.match(actionMenu, /<Teleport to="body">/);
  assert.match(actionMenu, /var\(--artaround-layer-popover/);
  assert.match(sessionActionSheet, /<Teleport to="body">/);
  assert.match(sessionActionSheet, /var\(--artaround-layer-drawer/);
  assert.match(sessionActionSheet, /event\.key !== "Tab"/);
  assert.match(sessionActionSheet, /returnFocus/);
  assert.match(synchronizedSession, /<Teleport to="body">/);
  assert.match(synchronizedSession, /var\(--artaround-layer-modal/);
  assert.match(synchronizedSession, /trapModalFocus/);
  assert.match(synchronizedSession, /groupReturnFocus/);
  assert.match(synchronizedSession, /voiceReturnFocus/);
});

test("l'action dialog Navigator implementa una vera decisione modale", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /returnFocus\?\.focus/);
  assert.match(dialog, /data-feedback-dialog-cancel/);
});

test("Navigator dispone di tutte le surface approvate", () => {
  for (const source of [callout, issuePanel, fieldFeedback, status, emptyState, progress, dialog, toastHost]) assert.ok(source.length > 0);
  assert.match(callout, /feedback-callout/);
  assert.match(issuePanel, /feedback-issue-panel/);
  assert.match(fieldFeedback, /feedback-field/);
  assert.match(status, /feedback-status/);
  assert.match(emptyState, /feedback-empty-state/);
  assert.match(progress, /feedback-progress/);
});

test("gli errori di autenticazione Navigator usano già il callout condiviso", () => {
  assert.match(login, /import FeedbackCallout/);
  assert.match(login, /<FeedbackCallout v-if="error" tone="danger" semantic-role="alert">/);
});

test("GeneratedPlan usa direttamente le surface condivise e non richiede adapter legacy", () => {
  assert.match(generatedPlan, /import AsyncBoundary/);
  assert.match(generatedPlan, /import FeedbackCallout/);
  assert.match(generatedPlan, /import FeedbackIssuePanel/);
  assert.match(generatedPlan, /<AsyncBoundary/);
  assert.match(generatedPlan, /<FeedbackCallout v-if="error" tone="danger" semantic-role="alert">/);
  assert.match(generatedPlan, /<FeedbackIssuePanel v-if="preparation\.readiness\.blockers\.length" tone="danger"/);
});

test("l'adapter Navigator mappa le azioni legacy per semantica, non per role generico", () => {
  assert.match(app, /<NavigatorLegacyFeedbackAdapter \/>/);
  assert.match(adapter, /function sessionNoticeMapping/);
  assert.match(adapter, /Percorso verso/);
  assert.match(adapter, /Visita completata/);
  assert.match(adapter, /Comando riconosciuto/);
  assert.match(adapter, /Nessun comando riconosciuto/);
  assert.match(adapter, /Obstacle checks/);
  assert.match(adapter, /markSurface\(error, "callout", "danger"\)/);
  assert.match(adapter, /markSurface\(warningList, "issue-panel", "warning"\)/);
  assert.match(adapter, /markSurface\(blockerList, "issue-panel", "danger"\)/);
  assert.doesNotMatch(adapter, /querySelectorAll\?\.\('\[role="status"\]'/);
});

test("tutti i canali reattivi di errore/notice del Navigator sono inventariati", () => {
  const files = vueFiles();
  const withError = files.filter(({ source }) => /const error = ref</.test(source)).map(({ name }) => name).sort();
  const withNotice = files.filter(({ source }) => /const notice = ref</.test(source)).map(({ name }) => name).sort();

  assert.deepEqual(withError, ["GenerateView.vue", "GeneratedPlanView.vue", "LibraryView.vue", "LoginView.vue", "SessionView.vue", "SynchronizedJoinView.vue", "SynchronizedSessionView.vue", "VisitDetailView.vue"]);
  assert.deepEqual(withNotice, ["SessionView.vue", "SynchronizedSessionView.vue"]);

  for (const selector of ["error-card", "session-feedback.error-feedback", "previsit-state.error-state", "inline-error"]) {
    assert.match(adapter, new RegExp(selector.replace(".", "\\.")));
  }
  for (const migratedSelector of ["library-state.error-state", "session-action-error", "removal-dialog", "confirm-removal"]) {
    assert.doesNotMatch(adapter, new RegExp(migratedSelector.replace(".", "\\.")));
  }
});

test("la Visita sincronizzata usa direttamente feedback e layer condivisi", () => {
  assert.match(synchronizedJoin, /import FeedbackCallout/);
  assert.match(synchronizedJoin, /<FeedbackCallout v-if="error"[^>]*tone="danger"[^>]*semantic-role="alert"/);
  assert.match(synchronizedSession, /import \{ notify \}/);
  assert.match(synchronizedSession, /import FeedbackActionDialog/);
  assert.match(synchronizedSession, /import FeedbackCallout/);
  assert.match(synchronizedSession, /import FeedbackProgressState/);
  assert.match(synchronizedSession, /<FeedbackActionDialog/);
  assert.match(synchronizedSession, /notify\.info\(/);
  assert.match(synchronizedSession, /notify\.warning\(/);
  assert.doesNotMatch(synchronizedSession, /z-index\s*:\s*50/);
});

test("Library usa direttamente command runner, feedback e ActionMenu condivisi", () => {
  assert.match(library, /import \{ runUiCommand \}/);
  assert.match(library, /import ActionMenu/);
  assert.match(library, /import AsyncBoundary/);
  assert.match(library, /import FeedbackCallout/);
  assert.match(library, /import FeedbackEmptyState/);
  assert.match(library, /import FeedbackActionDialog/);
  assert.match(library, /<ActionMenu/);
  assert.match(library, /<FeedbackCallout v-if="sessionActionError" tone="danger" semantic-role="alert">/);
  assert.match(library, /<FeedbackEmptyState v-if="!visits\.length">/);
  assert.match(library, /<FeedbackActionDialog/);
  assert.match(library, /library\.dismiss-session:/);
  assert.match(library, /successFeedback: \{ tone: "success", message: "Visita rimossa da quelle da riprendere\." \}/);
  assert.doesNotMatch(library, /removal-overlay|removal-dialog|resume-popover/);
});

test("la conferma di fine visita legacy resta proiettata sull'Action Dialog condiviso", () => {
  assert.match(adapter, /\.confirm-sheet\[role=\"alertdialog\"\]/);
  assert.match(adapter, /<FeedbackActionDialog/);
  assert.match(adapter, /tone="danger"/);
  assert.match(adapter, /\.confirm-completion/);
  assert.match(adapter, /resolveDialog\(true\)/);
});

test("il mapping azione -> surface copre le famiglie concrete dei due client", () => {
  for (const phrase of [
    "Namespace metadata saved",
    "Physical Vocabulary metadata saved",
    "Venue metadata / pre-visit / inventory / place / connection update succeeds",
    "Visit occurrence is ambiguous",
    "Item draft restored",
    "Login / registration request fails",
    "Generator precondition missing",
    "Visit preparation readiness blockers",
    "Session action succeeds with navigation request",
    "Session obstacle check returns a warning",
    "Finish-session request",
    "Map venue warnings",
    "Synchronized Visit cancellation",
  ]) assert.match(mapping, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("il bridge Marketplace non trasforma più la selezione di occorrenza in toast", () => {
  assert.match(marketplaceAdapter, /editor\.pendingOccurrence/);
  assert.match(marketplaceAdapter, /scegli l\['’\]occorrenza fisica corretta/);
  assert.match(marketplaceAdapter, /return null/);
  assert.match(marketplaceAdapter, /Testo rimosso dalla bozza/);
  assert.doesNotMatch(marketplaceAdapter, /SemanticEntityPicker/);
});
