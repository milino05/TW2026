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
if (!fs.existsSync("clients/navigator/public/maps/pinacoteca-bologna-demo.svg")) fail("Exam demo map asset missing");

requirePattern("scripts/examDatasetV2.js", /REQUIRED_USERNAMES[\s\S]*autore1[\s\S]*autore2[\s\S]*visitatore1[\s\S]*visitatore2/, "Four required accounts in exam seed");
requirePattern("scripts/examDatasetV2.js", /const WORKS[\s\S]*const VISIT_DEFINITIONS/, "Exam works and visit definitions");
requirePattern("scripts/examDatasetV2.js", /computeVenueReleaseIssues[\s\S]*computeVisitV2Integrity/, "Domain consistency checks in exam seed");
requirePattern("scripts/examDatasetV2.js", /async function verifyExamDataset/, "Automatic exam dataset verifier");
requirePattern("tests/examDatasetV2.test.js", /seedExamDataset[\s\S]*verifyExamDataset[\s\S]*idempotent/i, "Exam seed integration test");

requirePattern("app.js", /mountBuiltSpa[\s\S]*\/navigator[\s\S]*\/marketplace/, "Same-site client hosting");
requirePattern("clients/navigator/vite.config.ts", /base:\s*["']\/navigator\//, "Navigator deployment base");
requirePattern("clients/navigator/src/application/router.ts", /createWebHistory\(import\.meta\.env\.BASE_URL\)/, "Navigator router deployment base");
requirePattern("clients/marketplace/src/application/router.js", /BASE_PATH\s*=\s*["']\/marketplace["']/, "Marketplace deployment base");
requirePattern("Dockerfile", /build:clients/, "Production client build");

rejectPattern("docs/revision-workflow.md", /MuseumLayout|MuseumVocabulary|\/api\/museums\//, "Legacy museum workflow terminology");
rejectPattern("README.md", /seed completo[\s\S]{0,120}(?:ancora|deve essere completato)/i, "Stale seed TODO");
requirePattern("docs/deployment.md", /start mongodb[\s\S]*start node-22/, "Department gocker procedure");

if (failed) process.exit(1);
console.log("Slice 9 dataset, static hosting and deployment guardrails are intact.");
