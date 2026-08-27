const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const reliablePath = path.join(root, "clients/marketplace/src/ui/reliable-selects.js");
const appShellPath = path.join(root, "clients/marketplace/src/ui/app-shell.js");
const pickerPath = path.join(root, "clients/marketplace/src/ui/semantic-entity-picker.js");
const navigatorSelectPath = path.join(root, "clients/navigator/src/ui/ReliableSelect.vue");
const navigatorGeneratePath = path.join(root, "clients/navigator/src/ui/GenerateView.vue");
const reliable = fs.readFileSync(reliablePath, "utf8");
const appShell = fs.readFileSync(appShellPath, "utf8");
const picker = fs.readFileSync(pickerPath, "utf8");
const navigatorSelect = fs.readFileSync(navigatorSelectPath, "utf8");
const navigatorGenerate = fs.readFileSync(navigatorGeneratePath, "utf8");

test("il controller condiviso dei menu passa il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", reliablePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("tutti i select singoli del Marketplace vengono trasformati in menu interni", () => {
  assert.match(reliable, /select:not\(\[multiple\]\):not\(\[data-native-select\]\)/);
  assert.match(reliable, /role", "listbox"/);
  assert.match(reliable, /role", "option"/);
  assert.match(reliable, /select\.replaceWith\(wrapper\)/);
  assert.match(reliable, /wrapper\.append\(select, details, error\)/);
  assert.match(reliable, /new Event\("input", \{ bubbles: true \}\)/);
  assert.match(reliable, /new Event\("change", \{ bubbles: true \}\)/);
  assert.match(reliable, /Seleziona un'opzione prima di continuare/);
  assert.match(appShell, /observeReliableSelects\(this\)/);
  assert.match(picker, /observeReliableSelects\(this\.shadowRoot\)/);
});

test("le liste multiple restano native perché non usano un popup a scomparsa", () => {
  assert.match(reliable, /select\.multiple \|\| Number\(select\.size\) > 1/);
  assert.doesNotMatch(reliable, /select:not\(\[data-native-select\]\)(?!:not\(\[multiple\]\))/);
});

test("anche i controlli del Navigator usano il menu affidabile", () => {
  assert.match(navigatorSelect, /role="listbox"/);
  assert.match(navigatorSelect, /role="option"/);
  assert.match(navigatorSelect, /model\.value = value/);
  assert.match(navigatorGenerate, /import ReliableSelect/);
  assert.match(navigatorGenerate, /v-model="booleanRoutingChoices\[control\.key\]"/);
  assert.match(navigatorGenerate, /v-model="numericRoutingPriorities\[control\.key\]"/);
  assert.doesNotMatch(navigatorGenerate, /<select/);
});
