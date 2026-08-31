const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

test("realtime sincronizzato notifica soltanto invalidazione e presence, mantenendo REST autorevole", () => {
  const server = source("services/synchronizedVisitRealtime.service.js");
  const client = source("clients/navigator/src/infrastructure/realtime/synchronizedVisitRealtime.ts");
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(server, /roomName\(sessionId\)/);
  assert.match(server, /"synchronized:invalidated"/);
  assert.match(server, /sessionId:\s*String\(synchronizedSessionId\)/);
  assert.match(server, /runtimeVersion:\s*Number\(runtimeVersion\)\s*\|\|\s*null/);
  assert.match(server, /"synchronized:presence"/);
  assert.doesNotMatch(server, /SynchronizedVisitMembership\.(?:update|findOneAndUpdate)/);
  assert.match(client, /socket\.on\("connect", subscribe\)/);
  assert.match(view, /onInvalidated:\s*\(\)\s*=>\s*refresh\(\{ quiet: true \}\)/);
  assert.match(view, /window\.setInterval\(\(\)\s*=>\s*refresh\(\{ quiet: true \}\),\s*15000\)/);
});

test("il join temporaneo non crea diritti Marketplace permanenti", () => {
  const runtime = source("services/synchronizedVisitSession.service.js");
  assert.doesNotMatch(runtime, /MarketplaceAcquisition/);
  assert.doesNotMatch(runtime, /Entitlement/);
  assert.match(runtime, /SynchronizedVisitMembership\.create/);
  assert.match(runtime, /synchronizedSessionId:\s*group\._id/);
});

test("la visita sincronizzata riusa ascolto e comandi vocali senza concedere progressione ai partecipanti", () => {
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");
  const controlledVoice = source("clients/navigator/src/capabilities/controlledVoice.ts");
  const runtime = source("services/visitSessionV2.service.js");
  const groupRuntime = source("services/synchronizedVisitSession.service.js");
  const groupModel = source("models/synchronizedVisitSession.model.js");
  const dispatcher = source("services/actionDispatcherV2.service.js");

  assert.match(view, /browserTts\.speak\(presentation\.text/);
  assert.match(view, /browserTts\.pause\(\)/);
  assert.match(view, /browserTts\.resume\(\)/);
  assert.match(view, /browserControlledVoice\.listen\(/);
  assert.match(view, /await dispatch\(result\.action, null, "controlled_voice"\)/);
  assert.match(view, /groupPanelOpen/);
  assert.match(view, /class="group-sheet"/);
  assert.match(view, /class="group-sheet-scroll"/);
  assert.match(view, /synchronizedSession\.playback\.commandVersion/);
  assert.match(view, /applySharedPlayback/);
  assert.match(view, /\["progress", "synchronization", "navigation", "lifecycle", "quiz"\]/);
  assert.match(view, /isHost\.value\s*\?\s*\(runtime\.value\?\.availableActions/);
  assert.match(runtime, /if \(!synchronizedSession \|\| membership\?\.role === "host"\)/);
  assert.match(runtime, /if \(membership\?\.role === "host"\)[\s\S]*PROGRESS_NEXT/);
  assert.doesNotMatch(runtime, /membership\?\.role === "participant"[\s\S]{0,180}PROGRESS_NEXT/);
  assert.match(groupModel, /commandVersion/);
  assert.match(groupRuntime, /async function controlSynchronizedPlayback/);
  assert.match(groupRuntime, /Operazione riservata alla guida/);
  assert.match(dispatcher, /controlSynchronizedPlayback/);
  assert.match(dispatcher, /SYNCHRONIZED_PLAYBACK_PLAY/);
  assert.match(controlledVoice, /ensureMicrophonePermission/);
  assert.match(controlledVoice, /window\.isSecureContext/);
  assert.match(controlledVoice, /code === "no-speech"/);
  assert.match(controlledVoice, /attempts < 2/);
  assert.match(controlledVoice, /recognition\.interimResults = true/);
  assert.match(controlledVoice, /recognition\.maxAlternatives = 3/);
});
