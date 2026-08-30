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
  if (!/^[a-f0-9]{24}$/i.test(String(config.venueId || "")) || /^0{24}$/.test(String(config.venueId || ""))) fail("Navigator venueId must be a non-zero ObjectId");
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
requirePattern("scripts/examDatasetV2.js", /placeTypeId\("elevator"\)[\s\S]*placeTypeId\("stairs"\)/, "Elevator and stairs physical features in exam seed");
requirePattern("scripts/examDatasetV2.js", /async function verifyExamDataset/, "Automatic exam dataset verifier");
requirePattern("tests/examDatasetV2.test.js", /seedExamDataset[\s\S]*verifyExamDataset/, "Exam seed integration test functions");
requirePattern("tests/examDatasetV2.test.js", /acquireOffer[\s\S]*listNavigatorLibrary/, "Marketplace to Navigator E2E test");
requirePattern("tests/examDatasetV2.test.js", /idempotent/i, "Exam seed idempotence test");

requirePattern("config/physicalVocabularyStarter.js", /key:\s*"elevator"[\s\S]*key:\s*"stairs"/, "Starter elevator and stairs physical features");
requirePattern("tests/routingCatalogFacilities.test.js", /elevatorDefinition[\s\S]*stairsDefinition/, "Vocabulary-driven facility action regression test");

requirePattern("services/visitAuthoringV2.service.js", /getVisitAuthoringProjection[\s\S]*searchVisitAuthoringContent/, "Visit authoring projection and scalable search");
requirePattern("services/visitAuthoringV2.service.js", /mayEditEditorialRevision\(revision\)\s*\|\|\s*revision\.status\s*===\s*["']published["']/, "Published Visit edit through a new working revision");
requirePattern("services/visitAuthoringV2.service.js", /presentationProfiles/, "Visit authoring presentation-level metadata");
requirePattern("services/visitAuthoringV2.service.js", /primarySubjectId:\s*item\?\.primarySubjectId\s*\|\|\s*null/, "Visit entry primary Subject projection for anchor suggestions");
requirePattern("routes/marketplaceV2.routes.js", /visit-authoring\/new[\s\S]*visit-authoring\/releases\/:editorialReleaseId\/content[\s\S]*visit-authoring\/:visitId/, "Visit authoring read routes");
requirePattern("clients/marketplace/src/application/router.js", /\/workspace\/visit-authoring/, "Visit authoring client route");
requirePattern("clients/marketplace/src/ui/app-shell.js", /visit-authoring-view[\s\S]*artaround-visit-authoring-view/, "Visit authoring client mount");
rejectPattern("clients/marketplace/src/ui/app-shell.js", /visit-logistics-editor/, "Legacy separate Visit logistics mount");
requirePattern("clients/marketplace/src/ui/create-hub-view.js", /renderVisitCard[\s\S]*href="\/workspace\/visit-authoring"[\s\S]*Crea visita/, "Create hub new Visit entry point");
requirePattern("clients/marketplace/src/ui/workspace-view.js", /resourceType\s*===\s*["']visit["'][\s\S]*\/workspace\/visit-authoring\?visitId=/, "Workspace existing Visit authoringRef entry point");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /createVisit[\s\S]*updateVisit/, "Visit create and edit through VisitV2 API");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /Informazioni[\s\S]*Costruisci la visita[\s\S]*Impostazioni[\s\S]*Percorso[\s\S]*Pubblicazione/, "Five-step Visit authoring workflow");
for (const [pattern, label] of [
  [/visit-content-composer/, "Unified Visit composer"],
  [/renderVisitSequence/, "Visit sequence rendering"],
  [/data-add-content/, "Visit content add control"],
  [/data-drag-kind="stop"/, "Visit stop drag"],
  [/data-drag-kind="content"/, "Visit content drag"],
  [/data-move-stop/, "Accessible stop reorder"],
  [/data-move-content/, "Accessible content reorder"],
]) requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", pattern, label);
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /value="core"[\s\S]*value="recommended"[\s\S]*value="optional"/, "Visit content role controls");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /searchVisitContentCandidates[\s\S]*data-content-page/, "Paginated unified Visit content search");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /data-entry-stop[\s\S]*attachVisitContentToStop[\s\S]*detachVisitContentFromStop/, "Explicit content-to-anchor reassignment");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /Opzioni avanzate[\s\S]*Aggiungi una tappa senza contenuto[\s\S]*data-add-stop/, "Manual stops remain advanced authoring");
requirePattern("services/visitSequenceV2.service.js", /canonicalizeContentEntries[\s\S]*reorderWithinDeliveryGroup[\s\S]*sameDeliveryGroup/, "Canonical Visit sequence domain helper");
requirePattern("services/visitAuthoringSequenceCommandV2.service.js", /canonicalizeContentEntries[\s\S]*reorderWithinDeliveryGroup[\s\S]*updateVisitV2/, "Content reorder command preserves delivery groups");
requirePattern("services/sessionPlanV2.service.js", /canonicalizeContentEntries[\s\S]*orderedContentEntries/, "SessionPlan consumes canonical Visit sequence");
requirePattern("routes/visitsV2.routes.js", /commands\/content\/:contentEntryId\/reorder/, "Visit content reorder command route");
requirePattern("clients/marketplace/src/infrastructure/http/visit-sequence-repository.js", /commands\/content\/\$\{encodeURIComponent\(contentEntryId\)\}\/reorder/, "Visit sequence client command repository");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /preVisitNotes[\s\S]*routeHints/, "Visit logistics integrated while preserving route hints");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /data-visit-logistics[\s\S]*serializeRouteHints\(\)/, "Visit logistics editing boundary kept separate from content entries");
requirePattern("clients/marketplace/src/ui/visit-authoring-view.js", /executeWorkspaceOperation[\s\S]*resourceType:\s*["']visit["']/, "Backend-authoritative Visit workflow from editor");
rejectPattern("clients/marketplace/src/ui/visit-authoring-view.js", /window\.prompt\(/, "Native prompt in Visit workflow");
rejectPattern("clients/marketplace/src/ui/visit-authoring-view.js", /role:\s*["']logistics["']|itemType:\s*["']logistics["']/, "Logistics encoded as Visit content");
requirePattern("tests/visitAuthoringV2.test.js", /published[\s\S]*visit\.edit[\s\S]*in_review[\s\S]*workflow\.withdraw_review/, "Visit editor workflow regression test");
requirePattern("tests/visitAuthoringSequenceV2.test.js", /canonicalizzazione[\s\S]*stessa tappa[\s\S]*contestuali[\s\S]*OUT_OF_RANGE/, "Visit content sequence regression tests");

requirePattern("app.js", /mountBuiltSpa[\s\S]*res\.redirect\(308[\s\S]*\/navigator[\s\S]*\/marketplace/, "Same-site client hosting and canonical redirects");
requirePattern("clients/navigator/vite.config.ts", /base:\s*["']\/navigator\//, "Navigator deployment base");
requirePattern("clients/navigator/src/application/router.ts", /createWebHistory\(import\.meta\.env\.BASE_URL\)/, "Navigator router deployment base");
requirePattern("clients/marketplace/src/application/router.js", /BASE_PATH\s*=\s*["']\/marketplace["']/, "Marketplace deployment base");
requirePattern("clients/marketplace/index.html", /src=["']\/marketplace\/src\/main\.js["']/, "Marketplace nested-route module path");
requirePattern("Dockerfile", /build:clients/, "Production client build");

requirePattern("clients/navigator/src/ui/SessionView.vue", /\{\{\s*snapshot\.current\.presentation\.text\s*\}\}/, "Current presentation text rendered in SessionView");
requirePattern("clients/navigator/src/ui/SessionView.vue", /browserTts\.speak\(presentation\.text,\s*presentation\.locale/, "TTS reads the current presentation text");
requirePattern("clients/navigator/src/capabilities/controlledVoice.ts", /controlledVoiceAliases[\s\S]*normalize\(phrase\)\s*===\s*spoken/, "Controlled voice exact action matching");
requirePattern("clients/navigator/src/ui/SessionView.vue", /<SessionActionSheet[\s\S]*@select="requestAction"/, "Runtime action sheet mounted in SessionView");
requirePattern("clients/navigator/src/ui/SessionActionSheet.vue", /v-for="action in section\.actions"[\s\S]*@click="emit\('select', action\)"/, "Equivalent runtime action buttons");

rejectPattern("docs/revision-workflow.md", /MuseumLayout|MuseumVocabulary|\/api\/museums\//, "Legacy museum workflow terminology");
rejectPattern("README.md", /seed completo[\s\S]{0,120}(?:ancora|deve essere completato)/i, "Stale seed TODO");
requirePattern("docs/deployment.md", /start mongo[\s\S]*start node-22/, "Department gocker procedure");

if (failed) process.exit(1);
console.log("Slice 9 dataset, Visit authoring, logistics separation, compliance, static hosting and deployment guardrails are intact.");
