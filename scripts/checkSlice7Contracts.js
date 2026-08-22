const fs = require("fs");

let failed = false;
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }
function rejectPattern(file, pattern, label) {
  const text = read(file);
  if (text && pattern.test(text)) {
    console.error(`${label} in ${file}`);
    failed = true;
  }
}
function requirePattern(file, pattern, label) {
  const text = read(file);
  if (!text || !pattern.test(text)) {
    console.error(`${label} missing in ${file}`);
    failed = true;
  }
}

for (const file of [
  "services/generationAccess.service.js",
  "services/validation/generationV2.validation.js",
  "services/visitGeneratorV2.service.js",
  "clients/navigator/src/infrastructure/http/generatorRepository.ts",
  "clients/navigator/src/ui/GenerateView.vue",
]) {
  rejectPattern(file, /\beditorialContextIds\b/, "Legacy generator editorialContextIds contract");
}

rejectPattern(
  "services/generatedPlanMaterializationV2.service.js",
  /\b(?:variantId|representationId|placeId|venueReleaseId|layoutRevisionId|estimatedTiming|utilityScore|scoreBreakdown)\b|\bpath\s*:/,
  "GeneratedPlan materialization must not freeze runtime/presentation details into Visit",
);
rejectPattern(
  "services/generatedPlanProjectionV2.service.js",
  /\b(?:placeId|connectionId|venueReleaseId|layoutRevisionId|representationId|variantId|scoreBreakdown|searchDiagnostics)\b/,
  "Navigator GeneratedPlan projection exposes technical planner internals",
);
rejectPattern(
  "clients/navigator/src/application/router.ts",
  /path:\s*["']\/generate["'][\s\S]{0,160}?PlaceholderView|path:\s*["']\/generated-plans\/:planId["'][\s\S]{0,160}?PlaceholderView/,
  "Navigator generator route still uses PlaceholderView",
);

requirePattern(
  "services/generationSourceV2.service.js",
  /editorial_context[\s\S]*editorial_release/,
  "Typed live/pinned generation source contract",
);
requirePattern(
  "services/generatedPlanMaterializationV2.service.js",
  /\.filter\(\(leg\)\s*=>\s*leg\.type\s*===\s*["']inter_venue["']\)/,
  "Materialization must persist only inter-Venue route hints",
);
requirePattern(
  "models/visitV2.model.js",
  /materializedFromGeneratedPlanId/,
  "Visit GeneratedPlan provenance",
);
requirePattern(
  "models/generatedVisitPlanV2.model.js",
  /materializedVisitId/,
  "GeneratedPlan materialized Visit back-reference",
);
requirePattern(
  "controllers/generatedVisitsV2.controller.js",
  /projectGeneratedPlanV2/,
  "GeneratedPlan responses must use the Navigator projection",
);

if (failed) process.exit(1);
console.log("Slice 7 typed generation, projection and materialization boundaries are intact.");
