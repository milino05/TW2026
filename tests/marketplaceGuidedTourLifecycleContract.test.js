const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("clients/marketplace/src/main.js");
const controller = read("clients/marketplace/src/application/guided-tour-controller.js");
const adapter = read("clients/marketplace/src/ui/guided-tour-adapter.js");
const namespace = read("clients/marketplace/src/ui/namespace-editor-view.js");
const physical = read("clients/marketplace/src/ui/physical-vocabulary-editor-view.js");

test("Namespace e Physical attivano GuidedTourController senza duplicare gli step", () => {
  assert.match(main, /guided-tour-adapter\.js/);
  assert.match(adapter, /new GuidedTourController/);
  assert.match(adapter, /artaround-namespace-editor-view/);
  assert.match(adapter, /artaround-physical-vocabulary-editor-view/);
  assert.match(adapter, /progressSelector/);
  assert.doesNotMatch(adapter, /A cosa servono le regole editoriali|A cosa serve il vocabolario fisico/);
});

test("il controller supporta step runtime e persistenza seen", () => {
  assert.match(controller, /setSteps\(steps = \[\]\)/);
  assert.match(controller, /rememberSeen/);
  assert.match(controller, /wasSeen/);
  assert.match(controller, /setStep\(index\)/);
  assert.match(controller, /close\(reason = "dismissed"\)/);
});

test("la projection conserva la logica di dominio degli editor", () => {
  assert.match(namespace, /snapshotDraft/);
  assert.match(namespace, /TUTORIAL_STEPS\[this\.tutorialStep\]\.section/);
  assert.match(physical, /TUTORIAL_STEPS\[this\.tutorialStep\]\.section/);
  assert.match(physical, /data-starter-apply/);
  assert.match(adapter, /originalSetStep/);
  assert.match(adapter, /originalClose/);
  assert.match(adapter, /originalStart/);
});

test("le chiavi seen restano compatibili con i dati già salvati", () => {
  assert.match(adapter, /artaround\.namespace-editor\.tutorial\.v1/);
  assert.match(adapter, /artaround\.physical-vocabulary-editor\.tutorial\.v2/);
});
