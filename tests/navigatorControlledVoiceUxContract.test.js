const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sessionView = fs.readFileSync(path.join(root, "clients/navigator/src/ui/SessionView.vue"), "utf8");

test("il Navigator libera il lock vocale prima di eseguire il comando riconosciuto", () => {
  assert.match(
    sessionView,
    /voiceBusy\.value = false;\s+await requestAction\(result\.action, "controlled_voice"\);/,
  );
});

test("requestAction attende il dispatch anche per i comandi vocali", () => {
  assert.match(sessionView, /async function requestAction[\s\S]*?await dispatch\(action, channel\);/);
});
