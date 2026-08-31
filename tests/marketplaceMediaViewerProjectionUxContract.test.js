const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("clients/marketplace/src/main.js");
const adapter = read("clients/marketplace/src/ui/media-viewer-adapter.js");
const viewer = read("clients/marketplace/src/ui/media-viewer.js");

test("la projection media Item è attiva prima dell'app shell", () => {
  assert.match(main, /media-viewer-adapter\.js/);
  assert.ok(main.indexOf("media-viewer-adapter.js") < main.indexOf("app-shell.js"));
});

test("media viewer e adapter superano il syntax check", () => {
  for (const relative of [
    "clients/marketplace/src/ui/media-viewer.js",
    "clients/marketplace/src/ui/media-viewer-adapter.js",
  ]) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});

test("l'adapter è presentation-only e limitato alle immagini Item auditate", () => {
  assert.match(adapter, /ItemAuthoringView/);
  assert.match(adapter, /\.item-media-card > figure/);
  assert.match(adapter, /\.review-media > figure/);
  assert.match(adapter, /openMediaViewer/);
  assert.match(adapter, /role", "button/);
  assert.match(adapter, /tabindex", "0/);
  assert.match(adapter, /\["Enter", " "\]/);
  assert.doesNotMatch(adapter, /Repository|repository|fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test("il viewer resta un modal applicativo sotto ActionDialog e Toast", () => {
  assert.match(viewer, /mountUiLayer\(overlay, \{ kind: "modal"/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /restoreFocus/);
  assert.match(viewer, /event\.key !== "Tab"/);
  assert.doesNotMatch(viewer, /showModal|showPopover|popover=/);
  assert.doesNotMatch(viewer, /autoplay/);
});
