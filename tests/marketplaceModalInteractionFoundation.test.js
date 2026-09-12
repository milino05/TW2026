const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const lifecycle = read("clients/marketplace/src/application/modal-interaction.js");
const layerManager = read("clients/marketplace/src/application/layer-manager.js");
const styles = read("clients/marketplace/src/styles/modal-interaction.css");
const index = read("clients/marketplace/index.html");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || "";
}

test("Task Modal foundation delegates global layering and Escape to LayerManager", () => {
  assert.match(index, /modal-interaction\.css/);
  assert.match(lifecycle, /mountUiLayer/);
  assert.match(lifecycle, /kind,\s*lockScroll/);
  assert.match(lifecycle, /onEscape:\s*\(\)\s*=>\s*void requestDismiss\("escape"\)/);
  assert.match(layerManager, /event\.key !== "Escape" \|\| event\.defaultPrevented/);
  assert.doesNotMatch(lifecycle, /document\.addEventListener\(["']keydown/);
});

test("Escape, backdrop and explicit cancel converge on the same non-destructive dismiss request", () => {
  assert.match(lifecycle, /requestDismiss\("escape"\)/);
  assert.match(lifecycle, /requestDismiss\("backdrop"\)/);
  assert.match(lifecycle, /requestDismiss\("dismiss"\)/);
  assert.match(lifecycle, /canDismiss/);
  assert.match(lifecycle, /onRequestDismiss/);
  assert.doesNotMatch(lifecycle, /openActionDialog|accountRepository|managementRepository|marketplaceRepository|editorialRepository|authoringRepository|fetch\s*\(/);
  assert.doesNotMatch(lifecycle, /\b(?:createOffer|removeWorkspaceResource|trashVenue|deleteResource|confirmSensitiveAction)\b/);
});

test("modal lifecycle traps focus and restores the original opener across portal rerenders", () => {
  assert.match(lifecycle, /event\.key !== "Tab"/);
  assert.match(lifecycle, /document\.activeElement instanceof HTMLElement/);
  assert.match(lifecycle, /modalOwnerState = new WeakMap/);
  assert.match(lifecycle, /customElementOwner/);
  assert.match(lifecycle, /ownerState\.active \+= 1/);
  assert.match(lifecycle, /queueMicrotask/);
  assert.match(lifecycle, /restoreOwnerFocus/);
  assert.match(lifecycle, /returnFocus\.focus|state\.returnFocus.*focus/);
  assert.match(lifecycle, /initialFocus/);
});

test("unmounted modal staging nodes stay invisible until LayerManager owns them", () => {
  assert.match(styles, /html\s*\{\s*scrollbar-gutter:\s*stable/);
  assert.match(styles, /\.artaround-modal-layer:not\(\[data-artaround-layer\]\)\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(layerManager, /element\.dataset\.artaroundLayer = kind/);
  assert.match(layerManager, /delete element\.dataset\.artaroundLayer/);
});

test("Task Modal shell has one application-level vertical scroll owner", () => {
  const layerRule = cssRule("\\.artaround-modal-layer");
  const panelRule = cssRule("\\.artaround-task-modal");
  const bodyRule = cssRule("\\.artaround-task-modal__body");
  assert.match(layerRule, /overflow:\s*hidden/);
  assert.match(panelRule, /overflow:\s*hidden/);
  assert.match(panelRule, /grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(bodyRule, /overflow-y:\s*auto/);
  assert.match(bodyRule, /min-height:\s*0/);
  assert.doesNotMatch(layerRule, /overflow(?:-y)?:\s*(auto|scroll)/);
  assert.doesNotMatch(panelRule, /overflow(?:-y)?:\s*(auto|scroll)/);
  assert.doesNotMatch(styles, /context-task-modal/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /safe-area-inset-top/);
});

test("large Task Modals keep stable desktop geometry while preserving the shared scroll body", () => {
  const largeRule = cssRule("\\.artaround-task-modal--large");
  assert.match(largeRule, /width:\s*min\(62rem,\s*100%\)/);
  assert.match(largeRule, /height:\s*min\(42rem,/);
  assert.match(largeRule, /max-height:\s*min\(42rem,/);
  assert.match(largeRule, /100dvh\s*-\s*3rem/);
  assert.match(cssRule("\\.artaround-task-modal__body"), /overflow-y:\s*auto/);
});

test("resource-selection tasks share one responsive choice-card grammar", () => {
  assert.match(styles, /\.task-selection-layout/);
  assert.match(styles, /\.task-selection-toolbar/);
  assert.match(styles, /\.task-resource-choice-list/);
  assert.match(styles, /\.task-resource-choice\s*\{/);
  assert.match(styles, /\.task-resource-choice\[aria-current="true"\]/);
});

test("narrow viewports use a full-height modal without changing the scroll ownership contract", () => {
  assert.match(styles, /@media\s*\(max-width:\s*36rem\)/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /border-radius:\s*0/);
  assert.match(cssRule("\\.artaround-task-modal__body"), /overflow-y:\s*auto/);
});