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
  const controller = source("controllers/visitSessionsV2.controller.js");

  assert.match(server, /roomName\(sessionId\)/);
  assert.match(server, /"synchronized:invalidated"/);
  assert.match(server, /sessionId:\s*String\(synchronizedSessionId\)/);
  assert.match(server, /runtimeVersion:\s*Number\(runtimeVersion\)\s*\|\|\s*null/);
  assert.match(server, /"synchronized:presence"/);
  assert.match(server, /"synchronized:activity"/);
  assert.match(server, /presenceSnapshot/);
  assert.match(server, /aggregateConnectionActivity/);
  assert.match(server, /notifySynchronizedVisitChangedForVisitSession/);
  assert.doesNotMatch(server, /SynchronizedVisitMembership\.(?:update|findOneAndUpdate)/);
  assert.match(client, /socket\.on\("connect", subscribe\)/);
  assert.match(client, /setParticipantActivity/);
  assert.match(client, /latestActivity/);
  assert.match(view, /onInvalidated:\s*\(\)\s*=>\s*refresh\(\{\s*quiet:\s*true\s*\}\)/);
  assert.match(view, /window\.setInterval\(\(\)\s*=>\s*refresh\(\{\s*quiet:\s*true\s*\}\),\s*15000\)/);
  assert.match(controller, /recordContentEntryExperience/);
  assert.match(controller, /notifySynchronizedVisitChangedForVisitSession/);
});

test("foreground, audio e inattività alimentano la stessa presence effimera della visita", () => {
  const client = source("clients/navigator/src/infrastructure/realtime/synchronizedVisitRealtime.ts");
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(client, /socket\.emit\("synchronized:activity"/);
  assert.match(view, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(view, /PARTICIPANT_INACTIVE_GRACE_MS = 3000/);
  assert.match(view, /ttsState\.value === "speaking"/);
  assert.match(view, /mode:\s*"audio"/);
  assert.match(view, /mode:\s*"reading"/);
  assert.match(view, /return "Non attivo"/);
  assert.match(view, /`Sta seguendo · \$\{mode\}/);
  assert.match(view, /Richiesta: \$\{request\.label\}/);
  assert.match(view, /Ultima attività/);
});

test("il quiz sincronizzato mantiene raggiungibili tutte le domande e il pulsante di invio", () => {
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(view, /<section v-else-if="group\.synchronizedSession\.status === 'quiz'" class="quiz-card">/);
  assert.match(view, /\.together-page\{[^}]*height:100%[^}]*min-height:0[^}]*overflow-y:auto/);
  assert.match(view, /\.together-page\{[^}]*-webkit-overflow-scrolling:touch[^}]*touch-action:pan-y/);
  assert.match(view, /\{\{ actionBusy \? 'Invio…' : 'Invia le risposte' \}\}<\/button>/);
});

test("il join temporaneo non crea diritti Marketplace permanenti", () => {
  const runtime = source("services/synchronizedVisitSession.service.js");
  assert.doesNotMatch(runtime, /MarketplaceAcquisition/);
  assert.doesNotMatch(runtime, /Entitlement/);
  assert.match(runtime, /SynchronizedVisitMembership\.create/);
  assert.match(runtime, /synchronizedSessionId:\s*group\._id/);
});

test("la visita sincronizzata riusa ascolto e comandi vocali senza concedere progressione narrativa ai partecipanti", () => {
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");
  const controlledVoice = source("clients/navigator/src/capabilities/controlledVoice.ts");
  const runtime = source("services/visitSessionV2.service.js");
  const navigatorRuntime = source("services/navigatorRuntimeV2.service.js");
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
  assert.match(view, /aria-label="Apri controllo del gruppo"/);
  assert.match(view, /<Teleport to="body">/);
  assert.match(view, /var\(--artaround-layer-modal/);
  assert.match(view, /trapModalFocus/);
  assert.match(view, /<FeedbackActionDialog/);
  assert.match(view, /synchronizedSession\.playback\.commandVersion/);
  assert.match(view, /applySharedPlayback/);
  assert.match(view, /action\.runtimeScope !== "synchronized_visit_session"/);
  assert.match(view, /!\["synchronization",\s*"lifecycle",\s*"quiz"\]\.includes\(action\.family\)/);
  assert.match(view, /action\.type === "PROGRESS_NEXT" && action\.runtimeScope !== "synchronized_visit_session"/);
  assert.match(view, /action\.type === "PROGRESS_NEXT" && action\.runtimeScope === "synchronized_visit_session"/);
  assert.match(view, /personalNextAction\.value \|\| \(isHost\.value \? groupNextAction\.value : null\)/);
  assert.match(navigatorRuntime, /serverInput:\s*\{\s*executionMode:\s*"physical"\s*\}/);
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

test("il lifecycle TTS del partecipante alimenta ContentExperience senza spostare business logic nel client", () => {
  const tts = source("clients/navigator/src/capabilities/browserTts.ts");
  const telemetry = source("clients/navigator/src/application/synchronizedContentExperienceTelemetry.ts");
  const repository = source("clients/navigator/src/infrastructure/http/sessionRepository.ts");
  const main = source("clients/navigator/src/main.ts");

  assert.match(tts, /emitLifecycle\("started"\)/);
  assert.match(tts, /emitLifecycle\("paused"\)/);
  assert.match(tts, /emitLifecycle\("completed"\)/);
  assert.match(tts, /utterance\.onboundary/);
  assert.match(tts, /this\.resumeOffset = Math\.min/);
  assert.match(tts, /MAX_UTTERANCE_CHARS = 180/);
  assert.match(tts, /this\.startUtterance\(segment\.endOffset, "continuation"\)/);
  assert.match(tts, /return this\.startUtterance\(this\.resumeOffset, "resumed"\)/);
  assert.match(tts, /this\.utteranceVoice = this\.selectVoice\(this\.utteranceLocale\)/);
  assert.match(tts, /if \(this\.utteranceVoice\) utterance\.voice = this\.utteranceVoice/);
  assert.match(tts, /this\.utterance = null;\s*window\.speechSynthesis\.cancel\(\);\s*this\.setState\("paused"\)/);
  assert.match(tts, /activeSeconds/);
  assert.match(telemetry, /route\.name !== "together-session"/);
  assert.match(telemetry, /group\.membership\.role !== "participant"/);
  assert.match(telemetry, /sessionRepository\.recordContentExperience/);
  assert.match(telemetry, /Math\.min\(0\.94,/);
  assert.match(repository, /content-entries\/experience/);
  assert.match(main, /installSynchronizedContentExperienceTelemetry\(router\)/);
});

test("la ripresa sincronizzata non cancella la posizione locale già in pausa e non riavvia un audio attivo", () => {
  const view = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(view, /if \(playback\.state === "paused"\) \{\s*if \(ttsState\.value === "speaking"\) browserTts\.pause\(\);\s*return;/);
  assert.match(view, /if \(ttsState\.value === "paused"\) browserTts\.resume\(\);\s*else if \(ttsState\.value === "idle" && !browserTts\.speak/);
  assert.doesNotMatch(view, /if \(ttsState\.value === "speaking"\) browserTts\.pause\(\); else browserTts\.stop\(\);/);
});
