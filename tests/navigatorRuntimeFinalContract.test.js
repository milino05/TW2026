const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("execution preparation start returns the physically gated Navigator runtime projection", () => {
  const controller = source("controllers/executionPreparationsV2.controller.js");
  assert.match(controller, /require\("\.\.\/services\/navigatorRuntimeV2\.service"\)/);
  assert.match(controller, /currentNavigatorRuntimeProjection\(\{[\s\S]*?sessionId:\s*result\.session\._id[\s\S]*?userId:\s*req\.user\._id[\s\S]*?\}\)/);
  assert.match(controller, /json\(\{\s*\.\.\.result,\s*current,\s*alreadyStarted\s*\}\)/);
});

test("Navigator MapProjection exposes only the canonical narrative/planned/live runtime contract", () => {
  const repository = source("clients/navigator/src/infrastructure/http/navigationRepository.ts");
  const runtimeMap = source("services/navigatorMapProjectionV2.service.js");
  const selfGuidedView = source("clients/navigator/src/ui/SessionView.vue");

  assert.doesNotMatch(repository, /logicalCurrentStop/);
  assert.doesNotMatch(selfGuidedView, /logicalCurrentStop/);
  assert.match(repository, /narrativeContextStop:/);
  assert.match(repository, /plannedVisitRoute:\s*\{/);
  assert.match(repository, /activeNavigation:\s*ActiveNavigationProjection \| null/);
  assert.equal((repository.match(/\bplannedLegs:/g) || []).length, 1);
  assert.equal((repository.match(/\binterVenueTransitions:/g) || []).length, 1);
  assert.match(runtimeMap, /return \{\s*venues,\s*knownLocation,\s*narrativeContextStop,\s*selectableLocations,\s*plannedVisitRoute:/);
  assert.doesNotMatch(runtimeMap, /\.\.\.projectedBaseMap/);
});

test("physical facilities on the map reuse authorized navigation actions in self-guided and synchronized views", () => {
  const map = source("clients/navigator/src/ui/SessionMap.vue");
  const selfGuidedView = source("clients/navigator/src/ui/SessionView.vue");
  const synchronizedView = source("clients/navigator/src/ui/SynchronizedSessionView.vue");

  assert.match(map, /action\.actionId === `navigation\.place\.\$\{facility\.physicalFeatureRef\.definitionId\}`/);
  assert.match(map, /emit\('selectAction', facilityAction\(facility\)!\)/);

  assert.match(selfGuidedView, /:available-actions="snapshot\.availableActions"/);
  assert.match(selfGuidedView, /@select-action="requestAction"/);

  assert.match(synchronizedView, /:available-actions="runtime\.availableActions"/);
  assert.match(synchronizedView, /@select-action="requestPersonalAction"/);
  assert.match(synchronizedView, /const personalActions = computed\([\s\S]*?runtimeScope !== "synchronized_visit_session"/);
});
