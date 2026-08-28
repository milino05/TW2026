const fs = require("fs");

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function source(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function rejectFile(file, label = file) {
  if (fs.existsSync(file)) fail(`Obsolete Physical Domain file still present: ${label}`);
}

function rejectPattern(file, pattern, label) {
  const text = source(file);
  if (text && pattern.test(text)) fail(`${label} in ${file}`);
}

function requirePattern(file, pattern, label) {
  const text = source(file);
  if (!text || !pattern.test(text)) fail(`${label} missing in ${file}`);
}

for (const file of [
  "services/routingAttributeCatalog.service.js",
  "config/globalRoutingAttributes.js",
  "clients/marketplace/src/ui/venue-editor-routing-mixin.js",
  "clients/marketplace/src/ui/venue-editor-draft-mixin.js",
  "services/validation/venueRelease.validation.js",
]) rejectFile(file);

for (const [file, pattern, label] of [
  ["routes/venues.routes.js", /router\.patch\(\s*["']\/venues\/:venueId\/working-release["']/, "Legacy VenueRelease aggregate PATCH route"],
  ["controllers/venues.controller.js", /\bupdateWorkingRelease\b/, "Legacy VenueRelease aggregate controller"],
  ["services/venueRelease.service.js", /\bupdateWorkingVenueRelease\b/, "Legacy VenueRelease aggregate service"],
  ["clients/marketplace/src/infrastructure/http/management-repository.js", /\bupdateVenueRelease\s*\(/, "Legacy Marketplace VenueRelease snapshot client"],
  ["clients/navigator/src/infrastructure/http/generatorRepository.ts", /\battributeKey\b/, "Navigator physical requirement attributeKey contract"],
  ["services/validation/generationV2.validation.js", /["']attributeKey["']|\battributeKey\s*:/, "Generation physical requirement attributeKey contract"],
  ["models/layoutRevision.model.js", /\b(?:routingAttributes|routingPresets|canonicalKey|floorKey|typeKey)\b/, "Legacy Layout physical vocabulary field"],
]) rejectPattern(file, pattern, label);

const physicalProductionFiles = [
  "config/physicalVocabularyStarter.js",
  "services/physicalVocabulary.service.js",
  "services/physicalVocabularyRevision.service.js",
  "services/physicalVocabularyResolver.service.js",
  "services/physicalExecutionV2.service.js",
  "services/graphRouting.service.js",
  "services/generationOptionsV2.service.js",
  "services/venueLayoutCommand.service.js",
  "clients/marketplace/src/ui/physical-vocabulary-editor-view.js",
  "clients/marketplace/src/ui/venue-editor-view.js",
  "clients/navigator/src/ui/GenerateView.vue",
];
for (const file of physicalProductionFiles) {
  rejectPattern(file, /\bGLOBAL_PLACE_INTENTS\b|\bGLOBAL_ROUTING_ATTRIBUTE_CATALOG\b|\bFIND_TOILET\b|\bFIND_EXIT\b|\bcanonicalKey\b/, "Global/hardcoded physical ontology contract");
}

requirePattern(
  "clients/marketplace/src/application/router.js",
  /["']\/physical-vocabularies\/editor["']/,
  "PhysicalVocabulary Marketplace editor route",
);
requirePattern(
  "models/layoutRevision.model.js",
  /authoredAgainstPhysicalVocabularyRevisionId/,
  "LayoutRevision PhysicalVocabularyRevision pin",
);
requirePattern(
  "clients/navigator/src/infrastructure/http/generatorRepository.ts",
  /physicalFeatureRef/,
  "Navigator PhysicalFeatureRef contract",
);
requirePattern(
  "services/marketplaceResourceRemovalV2.service.js",
  /physical_vocabulary/,
  "PhysicalVocabulary coordinated Marketplace removal",
);
requirePattern(
  "services/venueTarget.service.js",
  /TARGET_IN_PUBLISHED_VISIT/,
  "VenueTarget published Visit lifecycle blocker",
);

if (failed) process.exit(1);
console.log("Physical Domain production contracts are aligned with the redesign.");
