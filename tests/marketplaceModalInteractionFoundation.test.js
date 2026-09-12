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
  assert.doesNotMatch(lifecycle, /confirm|delete|remove|repository|fetch\(/i);
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

test("narrow viewports use a full-height modal without changing the scroll ownership contract", () => {
  assert.match(styles, /@media\s*\(max-width:\s*36rem\)/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /border-radius:\s*0/);
  assert.match(cssRule("\\.artaround-task-modal__body"), /overflow-y:\s*auto/);
});
