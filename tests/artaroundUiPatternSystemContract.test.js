const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const marketplaceRunnerPath = path.join(root, "clients/marketplace/src/application/ui-command-runner.js");
const marketplaceOperationPath = path.join(root, "clients/marketplace/src/application/operation-presentation.js");
const marketplaceDestructivePath = path.join(root, "clients/marketplace/src/application/destructive-action-flow.js");
const marketplaceWorkflowPath = path.join(root, "clients/marketplace/src/application/revision-workflow.js");
const marketplaceWorkflowUiPath = path.join(root, "clients/marketplace/src/ui/revision-workflow-controls.js");
const marketplaceAsyncPath = path.join(root, "clients/marketplace/src/ui/async-boundary.js");
const navigatorRunnerPath = path.join(root, "clients/navigator/src/application/uiCommand.ts");
const navigatorOperationPath = path.join(root, "clients/navigator/src/application/operationPresentation.ts");
const navigatorAsyncPath = path.join(root, "clients/navigator/src/ui/AsyncBoundary.vue");
const docsPath = path.join(root, "docs/ui-application-pattern-system.md");

const read = (target) => fs.readFileSync(target, "utf8");

test("Marketplace application pattern modules passano il syntax gate", () => {
  for (const target of [marketplaceRunnerPath, marketplaceOperationPath, marketplaceDestructivePath, marketplaceWorkflowPath, marketplaceWorkflowUiPath, marketplaceAsyncPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("UiCommandRunner standardizza lifecycle e deduplica per command key in entrambi i client", () => {
  for (const source of [read(marketplaceRunnerPath), read(navigatorRunnerPath)]) {
    assert.match(source, /inFlight = new Map/);
    assert.match(source, /inFlight\.has\(commandKey\)/);
    assert.match(source, /setPending\?\.\(true\)/);
    assert.match(source, /clearError\?\.\(\)/);
    assert.match(source, /setError\?\./);
    assert.match(source, /refresh/);
    assert.match(source, /successFeedback/);
    assert.match(source, /failureFeedback/);
  }
});

test("OperationDescriptor arricchisce soltanto available operations backend e non sintetizza capability", () => {
  for (const source of [read(marketplaceOperationPath), read(navigatorOperationPath)]) {
    assert.match(source, /operationDescriptor/);
    assert.match(source, /operations\.map\(\(operation\) => operationDescriptor/);
    assert.match(source, /requiresMessage.*=== true/);
    assert.doesNotMatch(source, /ownerType|principalType|capabilit(?:y|ies).*includes|role.*includes/i);
    assert.doesNotMatch(source, /operations\.push|operations\.unshift|new Set\(.*operation/i);
  }
});

test("revision workflow filtra e ordina soltanto operation ricevute dal backend", () => {
  const application = read(marketplaceWorkflowPath);
  const ui = read(marketplaceWorkflowUiPath);
  assert.match(application, /presentAvailableOperations\(availableOperations/);
  assert.match(application, /\.filter\(isRevisionWorkflowOperation\)/);
  assert.match(ui, /set availableOperations/);
  assert.match(ui, /artaround:revision-workflow-operation/);
  assert.match(ui, /detail: \{ operation \}/);
  assert.doesNotMatch(ui, /Repository|fetch\(|availableOperations\.push/);
});

test("destructive flow usa Action Dialog globale e lo stesso command lifecycle", () => {
  const source = read(marketplaceDestructivePath);
  assert.match(source, /openActionDialog/);
  assert.match(source, /tone: "danger"/);
  assert.match(source, /runUiCommand/);
  assert.match(source, /typeof confirm === "function"/);
});

test("AsyncBoundary conserva la stessa tassonomia loading error empty ready", () => {
  const marketplace = read(marketplaceAsyncPath);
  const navigator = read(navigatorAsyncPath);
  assert.match(marketplace, /artaround-progress-state/);
  assert.match(marketplace, /artaround-callout tone="danger" role="alert"/);
  assert.match(marketplace, /artaround-empty-state/);
  assert.match(navigator, /FeedbackProgressState/);
  assert.match(navigator, /FeedbackCallout/);
  assert.match(navigator, /FeedbackEmptyState/);
  assert.match(navigator, /<slot v-else/);
});

test("la documentazione vieta editor universali e mantiene backend-authoritative le operazioni", () => {
  const docs = read(docsPath);
  assert.match(docs, /backend resta autorevole/i);
  assert.match(docs, /Non può sintetizzare operazioni mancanti/i);
  assert.match(docs, /Universal Resource Editor/);
  assert.match(docs, /EditorialRelease/);
});
