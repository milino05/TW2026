const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sessionView = fs.readFileSync(path.join(root, "clients/navigator/src/ui/SessionView.vue"), "utf8");
const synchronizedSessionView = fs.readFileSync(path.join(root, "clients/navigator/src/ui/SynchronizedSessionView.vue"), "utf8");

test("il Navigator libera il lock vocale prima di eseguire il comando riconosciuto", () => {
  assert.match(
    sessionView,
    /voiceBusy\.value = false;\s+await requestAction\(result\.action, "controlled_voice"\);/,
  );
});

test("requestAction attende il dispatch anche per i comandi vocali", () => {
  assert.match(sessionView, /async function requestAction[\s\S]*?await dispatch\(action, channel\);/);
});

test("nella Mappa i comandi vocali usano le stesse azioni dei luoghi mostrate nel pannello", () => {
  for (const view of [sessionView, synchronizedSessionView]) {
    assert.match(view, /usefulPlaceActions = computed\(\(\) => [^\n]+action\.type === "NAVIGATE_TO_PHYSICAL_FEATURE"/);
    assert.match(view, /voiceAvailableActions = computed\(\(\) => activeView\.value === "map" && usefulPlaceActions\.value\.length/);
    assert.match(view, /browserControlledVoice\.listen\([\s\S]{0,80}voiceAvailableActions\.value/);
  }
});
