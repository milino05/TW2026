const fs = require("fs");

let failed = false;
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }
function fail(message) { console.error(message); failed = true; }
function requirePattern(file, pattern, label) {
  const text = read(file);
  if (!text || !pattern.test(text)) fail(`${label} missing in ${file}`);
}
function rejectPattern(file, pattern, label) {
  const text = read(file);
  if (text && pattern.test(text)) fail(`${label} in ${file}`);
}

const configPath = "clients/navigator/public/navigator.config.json";
if (!fs.existsSync(configPath)) fail("Navigator static config missing");
else {
  const config = JSON.parse(read(configPath));
  if (!/^[a-f0-9]{24}$/i.test(String(config.venueId || "")) || /^0{24}$/.test(String(config.venueId || ""))) {
    fail("Navigator venueId must be a non-zero ObjectId");
  }
}
const mapPath = "clients/navigator/public/maps/pinacoteca-bologna-demo.svg";
if (!fs.existsSync(mapPath)) fail("Exam demo map asset missing");
else {
  requirePattern(mapPath, /Ascensore/i, "Elevator on demo map");
  requirePattern(mapPath, /Scale/i, "Stairs on demo map");
  requirePattern(mapPath, /non ufficiale/i, "Schematic map disclaimer");
}

requirePattern("scripts/examDatasetV2.js", /REQUIRED_USERNAMES[\s\S]*autore1[\s\S]*autore2[\s\S]*visitatore1[\s\S]*visitatore2/, "Four required accounts in exam seed");
requirePattern("scripts/examDatasetV2.js", /const WORKS[\s\S]*const VISIT_DEFINITIONS/, "Exam works and visit definitions");
requirePattern("scripts/examDatasetV2.js", /validateNamespaceRevisionSnapshot[\s\S]*validatePresentationAgainstNamespace[\s\S]*validateEditorialReleaseCoherence[\s\S]*computeVenueReleaseIssues[\s\S]*computeVisitV2Integrity[\s\S]*assertSelfContainedOffer/, "Domain consistency checks in exam seed");
requirePattern("scripts/examDatasetV2.js", /FIND_ELEVATOR[\s\S]*FIND_STAIRS/, "Elevator and stairs facilities in exam seed");
requirePattern("scripts/examDatasetV2.js", /async function verifyExamDataset/, "Automatic exam dataset verifier");
requirePattern("tests/examDatasetV2.test.js", /seedExamDataset[\s\S]*verifyExamDataset/, "Exam seed integration test functions");
requirePattern("tests/examDatasetV2.test.js", /acquireOffer[\s\S]*listNavigatorLibrary/, "Marketplace to Navigator E2E test");
requirePattern("tests/examDatasetV2.test.js", /idempotent/i, "Exam seed idempotence test");

requirePattern("services/routingAttributeCatalog.service.js", /FIND_ELEVATOR[\s\S]*FIND_STAIRS/, "Canonical elevator and stairs intents");
requirePattern("tests/routingCatalogFacilities.test.js", /FIND_ELEVATOR[\s\S]*FIND_STAIRS/, "Facility intent regression test");

requirePattern("services/visitAuthoringV2.service.js", /getVisitAuthoringProjection[\s\S]*searchVisitAuthoringContent/, "Visit authoring projection and scalable search");
requirePattern("services/visitAuthoringV2.service.js", /mayEditEditorialRevision\(revision\)\s*\|\|\s*revision\.status\s*===\s*["']published["']/, "Published Visit edit through a new working revision");
requirePattern("services/visitAuthoringV2.service.js", /presentationProfiles/, "Visit authoring presentation-level metadata");
requirePattern("routes/marketplaceV2.routes.js", /visit-authoring\/new[\s\S]*visit-authoring\/releases\/:editorialReleaseId\/content[\s\S]*visit-authoring\/:visitId/, "Visit authoring read routes");
requirePattern("clients/marketplace/src/application/router.js", /\/workspace\/visit-authoring/, "Visit authoring client route");
requirePattern("clients/marketplace/src/ui/app-shell.js", /visit-authoring-view[\s\S]*artaround-visit-authoring-view/, "Visit authoring client mount");
requirePattern("clients/marketplace/src/ui/workspace-view.js", /data-visit-editor[\s\S]*Crea nuova visita/, "Workspace Visit editor entry points");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /createVisit[\s\S]*updateVisit/, "Visit create and edit through VisitV2 API");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /data-move-entry[\s\S]*data-remove-entry/, "Visit content reorder and removal controls");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /value="core"[\s\S]*value="recommended"[\s\S]*value="optional"/, "Visit content role controls");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /searchVisitContent[\s\S]*data-content-page/, "Paginated Visit content search");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /executeWorkspaceOperation[\s\S]*resourceType:\s*["']visit["']/, "Backend-authoritative Visit workflow from editor");
requirePattern("tests/visitAuthoringV2.test.js", /published[\s\S]*visit\.edit[\s\S]*in_review[\s\S]*workflow\.withdraw_review/, "Visit editor workflow regression test");

requirePattern("app.js", /mountBuiltSpa[\s\S]*res\.redirect\(308[\s\S]*\/navigator[\s\S]*\/marketplace/, "Same-site client hosting and canonical redirects");
requirePattern("clients/navigator/vite.config.ts", /base:\s*["']\/navigator\//, "Navigator deployment base");
requirePattern("clients/navigator/src/application/router.ts", /createWebHistory\(import\.meta\.env\.BASE_URL\)/, "Navigator router deployment base");
requirePattern("clients/marketplace/src/application/router.js", /BASE_PATH\s*=\s*["']\/marketplace["']/, "Marketplace deployment base");
requirePattern("clients/marketplace/index.html", /src=["']\/marketplace\/src\/main\.js["']/, "Marketplace nested-route module path");
requirePattern("Dockerfile", /build:clients/, "Production client build");

requirePattern("clients/navigator/src/ui/SessionView.vue", /\{\{\s*snapshot\.current\.presentation\.text\s*\}\}/, "Current presentation text rendered in SessionView");
requirePattern("clients/navigator/src/ui/SessionView.vue", /browserTts\.speak\(presentation\.text,\s*presentation\.locale/, "TTS reads the current presentation text");
requirePattern("clients/navigator/src/capabilities/controlledVoice.ts", /controlledVoiceAliases[\s\S]*normalize\(phrase\)\s*===\s*spoken/, "Controlled voice exact action matching");
requirePattern("clients/navigator/src/ui/SessionView.vue", /availableActions[\s\S]*@click="dispatch\(action, 'button'\)"/, "Equivalent runtime action buttons");

rejectPattern("docs/revision-workflow.md", /MuseumLayout|MuseumVocabulary|\/api\/museums\//, "Legacy museum workflow terminology");
rejectPattern("README.md", /seed completo[\s\S]{0,120}(?:ancora|deve essere completato)/i, "Stale seed TODO");
requirePattern("docs/deployment.md", /start mongo[\s\S]*start node-22/, "Department gocker procedure");

if (failed) process.exit(1);
console.log("Slice 9 dataset, visit editor, compliance, static hosting and deployment guardrails are intact.");
