const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sessionView = fs.readFileSync(path.join(root, "clients/navigator/src/ui/SessionView.vue"), "utf8");
const sessionRepository = fs.readFileSync(path.join(root, "clients/navigator/src/infrastructure/http/sessionRepository.ts"), "utf8");
const sessionService = fs.readFileSync(path.join(root, "services/visitSessionV2.service.js"), "utf8");

test("la sessione proietta l'immagine editoriale senza confonderla con il riconoscimento fisico", () => {
  assert.match(sessionService, /illustrativeMedia: projectIllustrativeMedia\(runtime\.revision\)/);
  assert.match(sessionRepository, /illustrativeMedia: Array</);
  assert.doesNotMatch(sessionService, /recognitionMedia: projectIllustrativeMedia/);
});

test("il Navigator mostra l'immagine senza ritagliarla e consente di ingrandirla", () => {
  assert.match(sessionView, /const currentMedia = computed/);
  assert.match(sessionView, /v-if="currentMedia" class="content-media"/);
  assert.match(sessionView, /:alt="currentMedia\.altText"/);
  assert.match(sessionView, /mediaOpen = true/);
  assert.match(sessionView, /class="modal-overlay media-overlay"/);
  assert.match(sessionView, /\.content-media img[\s\S]*?object-fit: contain/);
  assert.match(sessionView, /max-height: 35vh/);
  assert.match(sessionView, /Fonte dell'immagine/);
});
